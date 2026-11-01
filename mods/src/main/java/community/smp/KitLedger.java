package community.smp;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.UUID;

/** Durable at-most-once reservation. An interrupted grant is NEVER retried automatically. */
public final class KitLedger {
    private final Path root;
    public KitLedger(Path root) throws IOException { this.root=root; Files.createDirectories(root); }
    private Path file(UUID player,String kit) {
        if (!kit.matches("[a-z0-9_-]{1,48}")) throw new IllegalArgumentException("Invalid kit ID");
        return root.resolve(player + "-" + kit + ".claim");
    }
    public boolean reserve(UUID player,String kit) throws IOException {
        try (var channel=FileChannel.open(file(player,kit),StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)) {
            channel.write(ByteBuffer.wrap("pending".getBytes(java.nio.charset.StandardCharsets.UTF_8)));channel.force(true);return true;
        } catch (java.nio.file.FileAlreadyExistsException exists) { return false; }
    }
    public boolean delivered(UUID player,String kit) throws IOException { return Files.readString(file(player,kit)).equals("delivered"); }
    public void complete(UUID player,String kit) throws IOException {
        try(var channel=FileChannel.open(file(player,kit),StandardOpenOption.WRITE,StandardOpenOption.TRUNCATE_EXISTING)){
            channel.write(ByteBuffer.wrap("delivered".getBytes(java.nio.charset.StandardCharsets.UTF_8)));channel.force(true);
        }
    }
}
