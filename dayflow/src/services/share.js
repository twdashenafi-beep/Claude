// Handing a piece of text to whatever the device sends things with.
//
// A chase is written to be sent, and the app is not a messaging app: it has no
// idea whether this person is reached by WhatsApp, by text or by email, and it
// should not have an opinion. So the draft goes to the share sheet, where that
// choice already lives and where the text can be edited before it goes.
//
// Where there is no share sheet the clipboard is the next best thing, and where
// there is neither the answer is that nothing happened — said out loud rather
// than silently, because a button that looks like it worked and did not is the
// worst of the three.
import { Platform, Share } from 'react-native';

// 'shared' | 'copied' | 'cancelled' | 'unavailable'
export async function shareText(text) {
  const body = String(text || '');
  if (!body) return 'unavailable';

  if (Platform.OS !== 'web') {
    try {
      const result = await Share.share({ message: body });
      return result && result.action === Share.dismissedAction ? 'cancelled' : 'shared';
    } catch {
      return 'unavailable';
    }
  }

  const nav = typeof navigator === 'undefined' ? null : navigator;

  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ text: body });
      return 'shared';
    } catch (e) {
      // Changing your mind is not a failure, and must not fall through to
      // quietly copying something you decided not to send.
      if (e && (e.name === 'AbortError' || e.name === 'NotAllowedError')) return 'cancelled';
      // Anything else — no share target, an unsupported payload — is worth
      // falling back from rather than giving up on.
    }
  }

  if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(body);
      return 'copied';
    } catch { /* blocked, or no permission */ }
  }

  return 'unavailable';
}
