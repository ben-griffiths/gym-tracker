# Workout chat XML (WebLLM)

The on-device model returns **one** XML document. The app strips fences, parses it, **repairs** values in TypeScript, then maps rows to `ChatSetSuggestion`.

## Root

`workout` with optional attribute:

- `exercise` — catalog slug (e.g. `bench-press`) when known or confidently matched.

## Sets

Self-closing tags only:

```xml
<s kind="working" r="5" w="100" u="kg"/>
```

Attributes:

| Name | Meaning |
|------|---------|
| `kind` | `warmup` \| `working` \| `backoff` \| `drop` (short aliases normalised in repair) |
| `r` | reps |
| `w` | weight |
| `u` | `kg` or `lb` |
| `n` | optional order hint (repair renumbers 1…N) |

## Example

```xml
<workout exercise="bench-press">
  <s kind="warmup" r="10" w="20" u="kg"/>
  <s kind="working" r="5" w="100" u="kg"/>
  <s kind="working" r="5" w="100" u="kg"/>
</workout>
```

## Repair (app-side)

- Clamp reps/weights and max row count.
- Renumber `n` in document order.
- Infer missing warmup loads when sandwiched between last warmup and first working set.
- Resolve ambiguous `exercise` using catalog search scores — never trust unknown slugs from the model.

Implementation: [`lib/workout-chat/workout-xml.ts`](../lib/workout-chat/workout-xml.ts).
