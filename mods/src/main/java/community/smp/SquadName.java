package community.smp;

import java.text.Normalizer;
import java.util.regex.Pattern;

/** Defence in depth for plain text received from the account service. */
final class SquadName {
    private static final Pattern INVALID = Pattern.compile("[\\p{C}§<>\\[\\]\\\\]");
    static String validate(String value) {
        if (value == null || value.length() > 128 || INVALID.matcher(value).find())
            throw new IllegalArgumentException("Invalid squad name");
        String name = Normalizer.normalize(value, Normalizer.Form.NFC).strip()
            .replaceAll("(?U)\\s+", " ").trim();
        if (name.length() > 32) throw new IllegalArgumentException("Squad name too long");
        return name;
    }
}
