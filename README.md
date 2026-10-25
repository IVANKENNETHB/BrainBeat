# BrainBeat.so

A general purpose quiz platform for cybersecurity training.

- Tauri 2 desktop shell, Rust + SQLite backend
- Vanilla JS frontend, no build step
- Multiple choice and scramble question types
- The admin (teacher) imports the question bank; the quiz setup adapts to it

## Using the app

1. On first launch, create the admin account.
2. Open **Settings → Question Bank** to add questions from a `.json`, `.csv`
   or `.txt` file. **Download Template** gives you a ready-to-fill example.
   The app ships with an empty bank, so importing is the first step.
3. Back on **Quiz Setup**, choose a mode, level, number of questions and
   timer, then start. The count chips follow the size of the imported bank,
   and the level decides the scramble mix.

Ties are ranked by score first and by answering time second.

## Development

```bash
npm install
npm run dev      # run the desktop app
npm run build    # bundle an installer
```

## Repository

Source code: https://github.com/USERNAME/BrainBeat

## Tests

```bash
npm test                                        # logic tests (Node)
npm run test:browser                            # browser smoke test (needs Edge/Chrome)
cargo test --manifest-path src-tauri/Cargo.toml # Rust backend tests
```
