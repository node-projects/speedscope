# demangle

A wrapper function on top of demangling functions from the `GNU libiberty`,
using emscripten.

# Build dependencies

## emscripten 4.0.0

Follow the official `emsdk` installation instructions:

https://emscripten.org/docs/getting_started/downloads.html#installation-instructions-using-the-emsdk-recommended

And make sure you have `emcc` in your PATH.

# Source dependencies

## GCC

Make sure to fetch `gcc` sources.

* `git clone https://github.com/gcc-mirror/gcc`
* `git reset --hard 40754a3b9bef83bf4da0675fcb378e8cd1675602`

# Build instructions

`make` to produce a single CommonJS module that contains also contain the base64 encoded wasm file.
`make TEST=1` to produce both a ES6 module AND the wasm file.

Using `make TEST=1` produce a file that can be used by `node` for testing purposes.

## Native wrapper lifetime

The wrapper saves the Emscripten stack before allocating its UTF-8 input and
restores it in `finally`, including when decoding throws. A nonzero native
result is freed in a nested `finally`. Keep these operations together: the
previous wrapper consumed stack on every call, and a direct repeated-call check
with the valid `_ZN3foo3barEv` symbol failed after about 4,056 calls. The current
regression calls the actual embedded wrapper 20,000 times and checks that its
stack pointer is unchanged. Memoization must not hide this test.

The generated module was rebuilt with Emscripten **4.0.0** (emsdk tag commit
`9853a6bfe637c8f44e9b4162b4a533f28df15c31`, compiler
`97c7c2adab1791b9487d1f376934a3bdc28f8a67`) and the GCC commit above. A second
build from the same inputs produced identical output. The embedded WASM is
69,563 bytes, SHA-256
`44af4513004f261cfde0fd3a9ec91c153f33c00890e1b9bb58367fd25944bdd5`.
The Makefile exports `stackSave`/`stackRestore` and includes its own flags and
both post-JS files as dependencies. SDK/GCC checkouts are not committed.

This fixes wrapper-owned temporary storage. It does not establish that every
native decoder failure or malformed producer symbol has been fixed. Emscripten
also documents [restoring the shadow stack when JavaScript catches native
exceptions](https://emscripten.org/docs/porting/exceptions.html#handling-c-exceptions-from-javascript).
