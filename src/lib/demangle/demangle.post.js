/**
 * DO NOT USE THIS FILE DIRECTLY.
 *
 * This file is only used as --post-js of emcc.
 *
 * This file provides a higher level demangle function ready to use
 * in JavaScript.
 */
Module['wasm_demangle'] = function(mangled) {
    /*
     * We are manually calling the lower-level generated functions
     * instead of using `cwrap` because we need to `free` the pointer
     * returned by `_demangle`.
     */
    const saved_stack = stackSave();
    let result_ptr = 0;
    try {
        const param_ptr = stringToUTF8OnStack(mangled);
        result_ptr = _demangle(param_ptr);
        return UTF8ToString(result_ptr);
    } finally {
        try {
            if (result_ptr) {
                _free(result_ptr);
            }
        } finally {
            stackRestore(saved_stack);
        }
    }
}
