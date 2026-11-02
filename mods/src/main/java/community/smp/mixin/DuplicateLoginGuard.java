package community.smp.mixin;

import com.mojang.authlib.GameProfile;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerLoginPacketListenerImpl;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ServerLoginPacketListenerImpl.class)
abstract class DuplicateLoginGuard {
    @Shadow @Final MinecraftServer server;
    @Shadow public abstract void disconnect(Component message);

    // Vanilla evicts the old player here, before any configuration-phase proof.
    @Inject(method="verifyLoginAndFinishConnectionSetup", at=@At("HEAD"), cancellable=true, require=1)
    private void rejectDuplicate(GameProfile profile, CallbackInfo callback) {
        if (server.isDedicatedServer() && server.getPlayerList().getPlayer(profile.getId()) != null) {
            disconnect(Component.literal("MineSPbSO: игрок с этим ником уже в игре."));
            callback.cancel();
        }
    }
}

