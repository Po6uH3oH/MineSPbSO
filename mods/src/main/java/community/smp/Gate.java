package community.smp;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.network.ConfigurationTask;
import net.minecraft.server.network.ServerConfigurationPacketListenerImpl;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.network.configuration.ICustomConfigurationTask;
import net.neoforged.neoforge.network.event.RegisterConfigurationTasksEvent;
import net.neoforged.neoforge.network.event.RegisterPayloadHandlersEvent;
import net.neoforged.neoforge.network.handling.IPayloadContext;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.minecraft.server.level.ServerPlayer;

@Mod("community_gate")
public final class Gate {
    static final ConfigurationTask.Type TASK = new ConfigurationTask.Type(ResourceLocation.fromNamespaceAndPath("community_gate", "account"));
    static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).followRedirects(HttpClient.Redirect.NEVER).build();
    static final Map<ServerConfigurationPacketListenerImpl, String> PENDING = new ConcurrentHashMap<>();
    static final KitAdapter KITS = new VanillaKitAdapter();
    public Gate(IEventBus bus) {
        bus.addListener(Gate::payloads);
        bus.addListener(Gate::configure);
        NeoForge.EVENT_BUS.addListener(Gate::starting);
        AccountWhitelist.register();
        NeoForge.EVENT_BUS.addListener(Gate::joined);
    }
    static void starting(ServerStartingEvent event) {
        if (!event.getServer().isDedicatedServer()) return;
        if(!"127.0.0.1".equals(event.getServer().getLocalIp()))throw new IllegalStateException("Community Gate requires server-ip=127.0.0.1 and a TLS gateway");
        if(event.getServer().usesAuthentication())throw new IllegalStateException("Community Gate requires online-mode=false");
    }
    static void joined(PlayerEvent.PlayerLoggedInEvent event) {
        if(!(event.getEntity() instanceof ServerPlayer player))return;
        try{var result=KITS.grant(player);if(result==KitAdapter.Result.DELIVERED)player.sendSystemMessage(Component.literal("Стартовый набор выдан."));else if(result==KitAdapter.Result.NEEDS_REVIEW)player.sendSystemMessage(Component.literal("Выдача набора ранее прервалась. Обратитесь к администратору."));else if(result==KitAdapter.Result.INVENTORY_FULL)player.sendSystemMessage(Component.literal("Освободите место в инвентаре и переподключитесь для получения набора."));}
        catch(Exception ex){player.sendSystemMessage(Component.literal("Набор не подтверждён. Обратитесь к администратору."));}
    }
    static void payloads(RegisterPayloadHandlersEvent event) {
        var r = event.registrar("2"); // Required: never mark optional.
        r.configurationToClient(Challenge.TYPE, Challenge.CODEC, Gate::clientChallenge);
        r.configurationToServer(Proof.TYPE, Proof.CODEC, Gate::serverProof);
    }
    static void configure(RegisterConfigurationTasksEvent event) {
        var listener = (ServerConfigurationPacketListenerImpl) event.getListener();
        if (listener.getConnection().isMemoryConnection()) return;
        event.register(new ICustomConfigurationTask() {
            public ConfigurationTask.Type type() { return TASK; }
            public void run(Consumer<CustomPacketPayload> sender) {
                var profile = listener.getOwner();
                if (!AccountWhitelist.allows(profile)) {
                    listener.disconnect(Component.literal("Аккаунт не в списке допуска. Подтвердите почту и повторите вход через несколько секунд."));
                    return;
                }
                JsonObject body = new JsonObject();
                body.addProperty("nickname", profile.getName());
                body.addProperty("uuid", profile.getId().toString());
                serverPost("/server/challenge", body).thenAccept(result -> {
                    String challenge = result.get("challenge").getAsString();
                    listener.getMainThreadEventLoop().execute(() -> {
                        if(!listener.getConnection().isConnected())return;
                        PENDING.put(listener, challenge);
                        sender.accept(new Challenge(challenge));
                    });
                    CompletableFuture.delayedExecutor(65, TimeUnit.SECONDS).execute(() -> {
                        listener.getMainThreadEventLoop().execute(() -> { if (PENDING.remove(listener, challenge)) listener.disconnect(Component.literal("Проверка входа истекла. Повторите вход через лаунчер.")); });
                    });
                }).exceptionally(ex -> { listener.disconnect(Component.literal("Сервис проверки входа недоступен. Повторите попытку позже.")); return null; });
            }
        });
    }
    static CompletableFuture<JsonObject> post(String base, String route, String key, JsonObject body) {
        try {
            URI uri = URI.create(base + route);
            if (!"https".equals(uri.getScheme()) && !("http".equals(uri.getScheme()) && "127.0.0.1".equals(uri.getHost()))) throw new IllegalArgumentException("HTTPS required");
            var request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(10)).header("Authorization", "Bearer " + key).header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body.toString())).build();
            return HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofString()).thenApply(r -> {
                if (r.statusCode() != 200 || r.body().length() > (route.equals("/server/whitelist") ? 1048576 : 16384)) throw new IllegalStateException("Authentication rejected");
                return JsonParser.parseString(r.body()).getAsJsonObject();
            });
        } catch (RuntimeException ex) { return CompletableFuture.failedFuture(ex); }
    }
    static CompletableFuture<JsonObject> serverPost(String route, JsonObject body) {
        String key = System.getenv("SMP_SERVER_KEY"), base = System.getenv("SMP_API_URL");
        if (key == null || key.length() < 32 || base == null) return CompletableFuture.failedFuture(new IllegalStateException("Missing server configuration"));
        return post(base, route, key, body);
    }
    static void clientChallenge(Challenge payload, IPayloadContext context) {
        String broker = System.getenv("SMP_BROKER_URL"), key = System.getenv("SMP_BROKER_KEY");
        String expectedPort = System.getenv("SMP_GAME_PORT");
        if (!(context.connection().getRemoteAddress() instanceof java.net.InetSocketAddress remote) || !remote.getAddress().isLoopbackAddress() || !Integer.toString(remote.getPort()).equals(expectedPort)) {
            context.disconnect(Component.literal("Проверка аккаунта разрешена только через защищённое подключение лаунчера."));return;
        }
        // Never send launcher credentials to an address supplied by the game server.
        if (broker == null || key == null || !broker.matches("http://127\\.0\\.0\\.1:[0-9]+")) { context.disconnect(Component.literal("Запустите игру через лаунчер сообщества.")); return; }
        JsonObject body = new JsonObject(); body.addProperty("challenge", payload.challenge());
        post(broker, "/ticket", key, body).thenAccept(r -> context.enqueueWork(() -> context.reply(new Proof(payload.challenge(), r.get("ticket").getAsString()))))
            .exceptionally(ex -> { context.disconnect(Component.literal("Не удалось подтвердить аккаунт. Войдите в лаунчер заново.")); return null; });
    }
    static void serverProof(Proof payload, IPayloadContext context) {
        var listener = (ServerConfigurationPacketListenerImpl) context.listener();
        if (!PENDING.remove(listener, payload.challenge())) { context.disconnect(Component.literal("Неверное или повторное подтверждение входа.")); return; }
        var profile = listener.getOwner();
        JsonObject body = new JsonObject();body.addProperty("challenge",payload.challenge());body.addProperty("ticket",payload.ticket());body.addProperty("nickname",profile.getName());body.addProperty("uuid",profile.getId().toString());
        serverPost("/server/consume",body).thenAccept(r -> context.enqueueWork(() -> {
            if (!profile.getName().equals(r.get("nickname").getAsString()) || !profile.getId().toString().equals(r.get("uuid").getAsString())) { context.disconnect(Component.literal("Профиль не совпадает с аккаунтом.")); return; }
            context.finishCurrentTask(TASK);
        })).exceptionally(ex -> { context.disconnect(Component.literal("Вход отклонён или сервис недоступен. Повторите вход через лаунчер.")); return null; });
    }
    public record Challenge(String challenge) implements CustomPacketPayload {
        static final Type<Challenge> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("community_gate","challenge"));
        static final StreamCodec<FriendlyByteBuf,Challenge> CODEC = new StreamCodec<>() {
            public Challenge decode(FriendlyByteBuf b) { return new Challenge(b.readUtf(100)); }
            public void encode(FriendlyByteBuf b,Challenge p) { b.writeUtf(p.challenge(),100); }
        };
        public Type<Challenge> type() { return TYPE; }
    }
    public record Proof(String challenge,String ticket) implements CustomPacketPayload {
        static final Type<Proof> TYPE = new Type<>(ResourceLocation.fromNamespaceAndPath("community_gate","proof"));
        static final StreamCodec<FriendlyByteBuf,Proof> CODEC = new StreamCodec<>() {
            public Proof decode(FriendlyByteBuf b) { return new Proof(b.readUtf(100),b.readUtf(100)); }
            public void encode(FriendlyByteBuf b,Proof p) { b.writeUtf(p.challenge(),100);b.writeUtf(p.ticket(),100); }
        };
        public Type<Proof> type() { return TYPE; }
    }
}
