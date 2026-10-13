// English only: a message clearly in another language gets a fixed English
// reply, and the model isn't called (it translates and answers anyway when
// only told not to). Plain code, so it's predictable and tested.
//
// It only catches the clear cases, and lets anything uncertain through: an
// email, a phone number, a name, one word ("gracias") or a mixed message
// all go to the model, which replies in English.

export const ENGLISH_ONLY_REPLY = "Sorry, I can only help in English. Could you write your message in English?";

// Common words of other languages written in Latin letters (Spanish, French,
// Portuguese, Italian, German) that aren't also everyday English words.
const FOREIGN = new Set(
  (
    "el los las una unos del al que qué por para con como cómo cuánto cuanto cuál dónde donde cuándo es está están son hola gracias quiero puedo tienen hay sí también pero muy " +
    "le les des du est sont vous je nous avec pour dans sur pas bonjour merci combien quel quelle où êtes avez suis " +
    "não você obrigado quanto custa olá também " +
    "il della sono questo quanto grazie ciao buongiorno " +
    "der die das und ist sind nicht ich sie wir mit für auf wie viel was hallo danke bitte kostet"
  ).split(" "),
);

// Everyday English words, to tell an English sentence with a foreign name or
// word in it from a foreign sentence.
const ENGLISH = new Set(
  "the a an is are was be do does can could would will i you we my your our it this that what how when where which who why to for of in on at and or with have has please hi hello thanks".split(" "),
);

export function isClearlyNotEnglish(message: string): boolean {
  // Emails and links say nothing about the language.
  const text = message.replace(/\S+@\S+|https?:\/\/\S+/g, " ");
  const latin = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  const otherLetters = (text.match(/\p{L}/gu) ?? []).length - latin;
  // Mostly another alphabet: Arabic, Cyrillic, Chinese, Hebrew, Greek…
  if (otherLetters > latin) return true;

  const words = text.toLowerCase().match(/[\p{L}'-]+/gu) ?? [];
  // "¿" and "¡" are as clear a sign as a word.
  const foreign = words.filter((w) => FOREIGN.has(w)).length + (text.match(/[¿¡]/g) ?? []).length;
  const english = words.filter((w) => ENGLISH.has(w)).length;
  return foreign >= 2 && foreign > english;
}
