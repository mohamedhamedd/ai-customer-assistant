// Which service a consultation request is for, decided by code from the
// business's services table (Admin > Services), never left to the model.
//
// The model sends a service; the customer's own messages say what they asked
// for. A request goes through only for one service that customers can
// request, under its exact name, and only when the choice is the customer's:
//   - one of their messages names it, and no other service as well
//     ("braces", "the take-home kit"); or
//   - the agent offered it as an option (choose_service) and the customer
//     has answered since ("the first one").
// Otherwise the result is choose_service with the options, and the agent
// must ask: which one, when several fit ("whitening"); or whether this is
// what they mean, when the customer's words name no service and the model
// picked one ("straighten my teeth", or "gum surgery" sent as an emergency
// exam). When nothing fits, service_not_found.
//
// Matching is by words, for any business: the words of a service's name
// against the words of a message, ignoring filler words ("consultation",
// "book", days, ...), email addresses and links, and endings ("crowns" is
// "crown", "whiter" is "whitening"). A message names one service when it is
// the only one sharing a word with it ("braces"), or when it shares the most
// words and the message has all of its main words, the ones outside brackets
// ("root canal, the molar" for "Root canal (molar)"; but "teeth whitening"
// doesn't settle "In-office teeth whitening" against "Take-home whitening kit").
//
// A business with no services table keeps free-text services, as before.

export interface ServiceEvidence {
  // The business's services table, in its order.
  services: { name: string; requestable: boolean }[];
  // What the customer wrote (or said), oldest first.
  customerSaid: string[];
  // The options of the latest choose_service, if the customer has answered
  // it since; otherwise empty.
  offered: string[];
}

export type ServiceChoice =
  | { kind: "ok"; service: string }
  | { kind: "choose"; options: string[] }
  | { kind: "not_found"; listed: boolean; options: string[] };

// Enough to read out; a longer list is a sign the customer should narrow it.
export const MAX_OPTIONS = 8;
export const MAX_LISTED = 40;

const FILLER = new Set(
  (
    "the and for with from that this those these into about your you our are was were has have had can could would should will shall " +
    "what which when where who how why not but also just very really some any all one two get got want wanted need needed like liked " +
    "please thanks thank hello hey yes yeah okay sure fine great good maybe well then there here its it's i'm i'd i'll we're " +
    "book booking booked request requesting appointment appointments consultation consultations consult session sessions service services visit " +
    "price prices cost costs much many time times date day days today tomorrow week weeks next morning afternoon evening noon " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december " +
    "name email phone number call contact take make give come see know think let try use other same first second third last"
  ).split(" "),
);

export function words(text: string): string[] {
  const plain = text.toLowerCase().replace(/\S+@\S+|https?:\/\/\S+|www\.\S+/g, " ");
  return [...new Set(plain.match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [])].filter((w) => w.length >= 3 && !FILLER.has(w) && !/^\d/.test(w));
}

const ENDINGS = ["s", "es", "ing", "ings", "ed", "er", "ers"];

// Same word, with an ending ("crown", "crowns"; "fill", "filling"), or the
// same first five letters ("whiter", "whitening").
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (long.startsWith(short) && ENDINGS.includes(long.slice(short.length))) return true;
  return short.length >= 5 && a.slice(0, 5) === b.slice(0, 5);
}

export interface Named {
  // Every service sharing a word with the text, in the table's order.
  matched: string[];
  // The one service the text names, if it names exactly one.
  only: string | null;
}

export function namedIn(text: string, names: string[]): Named {
  const said = words(text);
  const shares = (w: string) => said.some((s) => sameWord(s, w));
  const scores = names.map((name) => words(name).filter(shares).length);
  const matched = names.filter((_, i) => scores[i] > 0);
  if (matched.length <= 1) return { matched, only: matched[0] ?? null };
  const best = Math.max(...scores);
  const top = names.filter((_, i) => scores[i] === best);
  const main = top.length === 1 ? words(top[0].replace(/\([^)]*\)/g, " ")) : [];
  return { matched, only: top.length === 1 && main.every(shares) ? top[0] : null };
}

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function chooseService(requested: string, { services, customerSaid, offered }: ServiceEvidence): ServiceChoice {
  if (services.length === 0) return { kind: "ok", service: requested };
  const requestable = services.filter((s) => s.requestable).map((s) => s.name);
  const listedAs = services.find((s) => key(s.name) === key(requested));
  if (listedAs && !listedAs.requestable) return { kind: "not_found", listed: true, options: requestable.slice(0, MAX_LISTED) };

  // What the model sent: an exact name, or the names its words fit.
  const sent = namedIn(requested, requestable);
  const candidates = listedAs ? [listedAs.name] : sent.only ? [sent.only] : sent.matched;
  if (candidates.length === 0) return { kind: "not_found", listed: false, options: requestable.slice(0, MAX_LISTED) };
  // What each of the customer's messages names, and the latest that names any.
  const named = customerSaid.map((m) => namedIn(m, requestable)).filter((n) => n.matched.length > 0);
  const latest = named.at(-1)?.matched ?? [];

  const chosenByCustomer = candidates.filter((c) => offered.includes(c) || named.some((n) => n.only === c));
  if (chosenByCustomer.length === 1) return { kind: "ok", service: chosenByCustomer[0] };

  // Several the customer chose between, or what the model sent and what the
  // customer last named: theirs to choose (one option: whether it's what they mean).
  const options = requestable.filter((n) => (chosenByCustomer.length > 1 ? chosenByCustomer : [...candidates, ...latest]).includes(n));
  return { kind: "choose", options: options.slice(0, MAX_OPTIONS) };
}
