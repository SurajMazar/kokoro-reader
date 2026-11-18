/*
 * Kokoro Reader: phonemizer entry points for the espeak-ng WebAssembly build.
 *
 * kr_phonemize() follows piper1-gpl's espeakbridge.c (GPL-3.0): it walks the
 * text clause by clause with espeak_TextToPhonemesWithTerminator and reports
 * each clause's IPA, its terminating punctuation and whether it ends a
 * sentence. Records are separated by \x1e and fields by \x1f.
 */
#include <emscripten/emscripten.h>
#include <espeak-ng/speak_lib.h>
#include <stdlib.h>
#include <string.h>

/* From libespeak-ng/translate.h. */
#define CLAUSE_INTONATION_FULL_STOP 0x00000000
#define CLAUSE_INTONATION_COMMA 0x00001000
#define CLAUSE_INTONATION_QUESTION 0x00002000
#define CLAUSE_INTONATION_EXCLAMATION 0x00003000
#define CLAUSE_TYPE_CLAUSE 0x00040000
#define CLAUSE_TYPE_SENTENCE 0x00080000
#define CLAUSE_PERIOD (40 | CLAUSE_INTONATION_FULL_STOP | CLAUSE_TYPE_SENTENCE)
#define CLAUSE_COMMA (20 | CLAUSE_INTONATION_COMMA | CLAUSE_TYPE_CLAUSE)
#define CLAUSE_QUESTION (40 | CLAUSE_INTONATION_QUESTION | CLAUSE_TYPE_SENTENCE)
#define CLAUSE_EXCLAMATION (45 | CLAUSE_INTONATION_EXCLAMATION | CLAUSE_TYPE_SENTENCE)
#define CLAUSE_COLON (30 | CLAUSE_INTONATION_FULL_STOP | CLAUSE_TYPE_CLAUSE)
#define CLAUSE_SEMICOLON (30 | CLAUSE_INTONATION_COMMA | CLAUSE_TYPE_CLAUSE)

static char *out = NULL;
static size_t out_len = 0, out_cap = 0;

static void append(const char *s) {
  size_t n = strlen(s);
  if (out_len + n + 1 > out_cap) {
    out_cap = (out_len + n + 1) * 2;
    out = realloc(out, out_cap);
  }
  memcpy(out + out_len, s, n);
  out_len += n;
  out[out_len] = 0;
}

EMSCRIPTEN_KEEPALIVE int kr_init(const char *data_path, const char *voice) {
  if (espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, data_path, 0) < 0) return -1;
  return espeak_SetVoiceByName(voice) == EE_OK ? 0 : -2;
}

EMSCRIPTEN_KEEPALIVE const char *kr_phonemize(const char *text) {
  out_len = 0;
  append("");
  const void *ptr = text;
  int first = 1;
  while (ptr != NULL) {
    int terminator = 0;
    const char *phonemes = espeak_TextToPhonemesWithTerminator(&ptr, espeakCHARS_UTF8, espeakPHONEMES_IPA, &terminator);
    terminator &= 0x000FFFFF;
    const char *t = "";
    if (terminator == CLAUSE_PERIOD) t = ".";
    else if (terminator == CLAUSE_QUESTION) t = "?";
    else if (terminator == CLAUSE_EXCLAMATION) t = "!";
    else if (terminator == CLAUSE_COMMA) t = ",";
    else if (terminator == CLAUSE_COLON) t = ":";
    else if (terminator == CLAUSE_SEMICOLON) t = ";";
    if (!first) append("\x1e");
    first = 0;
    append(phonemes ? phonemes : "");
    append("\x1f");
    append(t);
    append("\x1f");
    append((terminator & CLAUSE_TYPE_SENTENCE) == CLAUSE_TYPE_SENTENCE ? "1" : "0");
  }
  return out;
}
