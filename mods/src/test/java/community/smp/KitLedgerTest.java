package community.smp;
import java.nio.file.Files;
import java.util.UUID;
public final class KitLedgerTest {
 public static void main(String[] args) throws Exception {
  var folder=Files.createTempDirectory("kit-ledger-test");var id=UUID.randomUUID();var first=new KitLedger(folder);
  if(!first.reserve(id,"starter"))throw new AssertionError("first grant");
  var restarted=new KitLedger(folder);if(restarted.reserve(id,"starter"))throw new AssertionError("duplicate after restart");
  if(restarted.delivered(id,"starter"))throw new AssertionError("pending must not report success");
  restarted.complete(id,"starter");if(!first.delivered(id,"starter"))throw new AssertionError("completion");
  if(first.reserve(id,"starter"))throw new AssertionError("duplicate after completion");
  try{first.reserve(id,"../evil");throw new AssertionError("path accepted");}catch(IllegalArgumentException expected){}
  System.out.println("KitLedger: PASS (repeat, restart, interrupted grant, completion, path safety)");
 }
}
