# UniFFI spike (Phase 2, ADR-007)

De-risks calling the Moodwave Rust core from React Native via UniFFI.

## What is proven here

1. **Typed API surface** — `crates/moodwave-ffi` exposes `analyze_file`,
   `classify_features`, `analyze_and_classify` with typed records
   (`FfiFeatureVector`, `FfiAnalysisResult`) and typed errors
   (`FfiException.Analysis` / `.Classification`). All logic stays in the
   core crates; the FFI layer is pure translation.
2. **Binding generation** — Kotlin bindings generated with
   `cargo run -p moodwave-ffi --bin uniffi-bindgen -- generate --library
   target/release/libmoodwave_ffi.so --language kotlin`.
3. **Typed calls from Kotlin/JVM over JNA** — `Spike.kt` compiles against
   the generated bindings and runs against the host cdylib:

   ```
   java -Djna.library.path=target/release \
        -cp spike/rn-spike/build:spike/rn-spike/jna-5.17.0.jar:$KOTLINC/lib/kotlin-stdlib.jar \
        com.moodwave.spike.SpikeKt
   ```

   Output: feature vector + 12 axis scores + 13 channel scores + typed
   error round-trip. This is the same binding code path (UniFFI Kotlin +
   JNA + `System.loadLibrary`) that RN Android uses.
4. **Android cross-build** — the cdylib builds for
   `aarch64-linux-android` (API 21, NDK r27c):

   ```
   NDK=<ndk>/ LLVM=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin
   CC_aarch64_linux_android=$LLVM/aarch64-linux-android21-clang \
   AR_aarch64_linux_android=$LLVM/llvm-ar \
   RANLIB_aarch64_linux_android=$LLVM/llvm-ranlib \
   CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER=$LLVM/aarch64-linux-android21-clang \
   cargo build -p moodwave-ffi --release --target aarch64-linux-android
   ```

   (rusqlite's bundled SQLite cross-compiles with NDK clang + llvm-ar.)

## Not yet proven (remaining gate item)

Running inside a real RN app on an Android emulator/device. Steps when we
do it (Phase 5 tooling lands here):

1. Install Android SDK (cmdline-tools, platform-tools, emulator, an
   API-34 x86_64 system image) and create an AVD (KVM is available).
2. `npx @react-native-community/cli init moodwave-spike`.
3. Drop the generated Kotlin bindings into `android/app/src/main/java`
   and the cross-built `.so` into `android/app/src/main/jniLibs/arm64-v8a/`
   (or use `cargo-ndk` + a gradle task).
4. Call `analyzeAndClassify(...)` from a minimal screen and verify the
   scores render.
