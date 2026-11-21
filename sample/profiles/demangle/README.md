# Demangling regression input

`grpc-symbol.txt` is the single C++ symbol supplied by `stevealx` in
[upstream issue #508](https://github.com/jlfwong/speedscope/issues/508#issuecomment-4937815262).
It exercises a large template symbol after repeated native calls. It is test
data, not an instruction or an entire profile capture. The original reporter's
29 MB Chromium recording is not available in that discussion.

LLVM's `c++filt` decodes this 1,252-character symbol, but the pinned libiberty
currently declines it: its component estimate is twice the input length,
exceeding the default 2,048-component limit. That decoding limitation remains
open under #508. The regression checks that the native wrapper remains usable
after this input; it does not claim to decode the complete gRPC name.
