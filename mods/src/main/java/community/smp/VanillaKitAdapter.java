package community.smp;

import com.google.gson.JsonParser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

/** No Simple Kits commands are assumed. Uses Minecraft's inventory API. */
public final class VanillaKitAdapter implements KitAdapter {
    public Result grant(ServerPlayer player) throws Exception {
        Path config=Path.of("config","community-kit.json");
        if(!Files.exists(config))return Result.DISABLED;
        var json=JsonParser.parseString(Files.readString(config)).getAsJsonObject();
        if(!json.get("enabled").getAsBoolean())return Result.DISABLED;
        String id=json.get("id").getAsString();
        var stacks=new ArrayList<ItemStack>();
        for(var element:json.getAsJsonArray("items")){
            var entry=element.getAsJsonObject();var item=BuiltInRegistries.ITEM.get(ResourceLocation.parse(entry.get("item").getAsString()));int count=entry.get("count").getAsInt();
            if(item==Items.AIR||count<1||count>item.getDefaultMaxStackSize())throw new IllegalArgumentException("Invalid kit item");
            stacks.add(new ItemStack(item,count));
        }
        if(stacks.isEmpty()||stacks.size()>36)throw new IllegalArgumentException("Invalid kit size");
        long free=player.getInventory().items.stream().filter(ItemStack::isEmpty).count();
        if(free<stacks.size())return Result.INVENTORY_FULL;
        var ledger=new KitLedger(player.getServer().getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT).resolve("community-kit-claims"));
        if(!ledger.reserve(player.getUUID(),id))return ledger.delivered(player.getUUID(),id)?Result.ALREADY_RECEIVED:Result.NEEDS_REVIEW;
        for(var stack:stacks)if(!player.getInventory().add(stack))throw new IllegalStateException("Inventory changed during grant");
        // Save inventory before marking complete. A crash leaves pending and needs
        // administrator reconciliation; it cannot cause automatic duplicate items.
        player.getServer().getPlayerList().saveAll();
        ledger.complete(player.getUUID(),id);
        return Result.DELIVERED;
    }
}
