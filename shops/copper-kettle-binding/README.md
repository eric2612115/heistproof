# Copper Kettle, with one planted mistake (a test shop)

This is [Copper Kettle](../copper-kettle/README.md) with one deliberate mistake, written by `node scripts/plant-binding.mjs`:
its capture route lets a `ref` field in the request body choose which shop order the payment pays for, so one payment can
pay for two orders. None of Heistproof's ten scripted robberies can see it; it exists to show what the AI thief finds, judged
by the books (one capture standing behind two shipped orders). Do not copy this code.
