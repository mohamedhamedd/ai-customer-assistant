import { test } from "node:test";
import assert from "node:assert/strict";
import { isClearlyNotEnglish } from "./language";

test("messages clearly in another language are caught", () => {
  for (const message of [
    "ما هي ساعات العمل يوم السبت؟",
    "¿Cuánto cuesta el blanqueamiento dental?",
    "Bonjour, est-ce que vous acceptez les cartes de crédit ?",
    "Wie viel kostet das Bleaching?",
    "Quanto custa o clareamento?",
    "Сколько стоит отбеливание?",
    "牙齿美白多少钱？",
  ]) {
    assert.equal(isClearlyNotEnglish(message), true, message);
  }
});

test("English, and anything uncertain, goes through", () => {
  for (const message of [
    "What are your opening hours on Saturday?",
    "teeth whitening",
    "can you respond without yapping",
    "sara.lone@example.com",
    "+1 503 555 0142",
    "Mohamed Hamed, mohamed@example.com",
    "My name is José García and I'd like a cleaning",
    "Is the café next door open?",
    "My name is محمد, can you call me?",
    "gracias",
    "ok",
    "👍",
    "",
  ]) {
    assert.equal(isClearlyNotEnglish(message), false, message);
  }
});
