package community.smp;
import net.minecraft.server.level.ServerPlayer;
public interface KitAdapter {
    enum Result { DELIVERED, ALREADY_RECEIVED, DISABLED, INVENTORY_FULL, NEEDS_REVIEW }
    Result grant(ServerPlayer player) throws Exception;
}
