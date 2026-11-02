package community.smp;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.mojang.authlib.GameProfile;
import com.mojang.logging.LogUtils;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.players.PlayerList;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

final class AccountWhitelist {
    private static final Gson GSON = new Gson();
    private static MinecraftServer owner;
    private static boolean fetching;
    private static boolean available;
    private static Map<UUID,String> allowed = Map.of();

    static void register() {
        NeoForge.EVENT_BUS.addListener(AccountWhitelist::start);
        NeoForge.EVENT_BUS.addListener(AccountWhitelist::tick);
        NeoForge.EVENT_BUS.addListener(AccountWhitelist::stop);
    }

    static boolean available() { return available; }

    static boolean allows(GameProfile profile) {
        return profile.getName().equals(allowed.get(profile.getId()));
    }

    private static void start(ServerStartedEvent event) {
        var server = event.getServer();
        if (!server.isDedicatedServer()) return;
        if (!server.getPlayerList().isUsingWhitelist())
            throw new IllegalStateException("Community Gate requires white-list=true");
        owner = server;
        allowed = Map.of();
        refresh(server);
    }

    private static void stop(ServerStoppedEvent event) {
        if (owner == event.getServer()) { owner = null; fetching = false; available = false; allowed = Map.of(); }
    }

    private static void tick(ServerTickEvent.Post event) {
        var server = event.getServer();
        if (server == owner && server.getTickCount() % 200 == 0 && !fetching) refresh(server);
    }

    private static void refresh(MinecraftServer server) {
        fetching = true;
        Gate.serverPost("/server/whitelist", new JsonObject())
            .thenApply(AccountWhitelist::parse)
            .whenComplete((snapshot, error) -> server.execute(() -> {
                if (owner != server) return;
                fetching = false;
                try {
                    if (error != null) throw new IOException("Account API unavailable", error);
                    apply(server, snapshot);
                } catch (Exception failure) {
                    available = false;
                    allowed = Map.of(); // A stale disk list alone never authorizes a connection.
                    LogUtils.getLogger().warn("Community Gate: whitelist sync failed; new logins denied");
                }
            }));
    }

    private static Map<UUID,String> parse(JsonObject response) {
        Map<UUID,String> rows = new LinkedHashMap<>();
        for (var row : response.getAsJsonArray("players")) {
            var json = row.getAsJsonObject();
            String name = json.get("name").getAsString();
            UUID id = UUID.fromString(json.get("uuid").getAsString());
            if (!name.matches("[a-zA-Z0-9_]{3,16}") ||
                !id.equals(UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8))) ||
                rows.put(id,name) != null) throw new IllegalArgumentException("Invalid account roster");
        }
        return rows;
    }

    private static void apply(MinecraftServer server, Map<UUID,String> rows) throws IOException {
        Path file = PlayerList.WHITELIST_FILE.toPath().toAbsolutePath();
        JsonArray entries = new JsonArray();
        rows.forEach((id,name) -> {
            JsonObject entry = new JsonObject();
            entry.addProperty("uuid",id.toString());
            entry.addProperty("name",name);
            entries.add(entry);
        });
        String content = GSON.toJson(entries);
        boolean changed = !Files.exists(file) || !Files.readString(file).equals(content);
        if (changed) {
            if (Files.exists(file)) {
                try { Files.copy(file, file.resolveSibling("whitelist.before-community-gate.json")); }
                catch (FileAlreadyExistsException alreadyBackedUp) { /* keep first snapshot */ }
            }
            Path temp = Files.createTempFile(file.getParent(), ".whitelist-", ".tmp");
            try {
                Files.writeString(temp, content);
                Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
            } finally { Files.deleteIfExists(temp); }
        }
        // Reload even after restart when the bytes on disk already match.
        if (changed || !available || !rows.equals(allowed)) server.getPlayerList().reloadWhiteList();
        available = true;
        allowed = Map.copyOf(rows);
        for (var player : List.copyOf(server.getPlayerList().getPlayers()))
            if (!allows(player.getGameProfile()))
                player.connection.disconnect(Component.literal("Доступ аккаунта к серверу отозван."));
    }
}
