# Property-test migration

The utility and LRU suites use fast-check 4.10.3. Byte domains remain signed
8-bit for bisect inputs and unsigned 8-bit for base64 data. Generated arrays
now cover up to 50 values; cache histories cover up to 100 commands, retaining
the 1,000-run cache comparison against the slow reference implementation.
Fast-check reports a seed and shrink path on failure for deterministic replay.

The math suite still uses jsverify. This is intentional partial progress on
[#354](https://github.com/jlfwong/speedscope/issues/354), not a completed migration.
The previous default number generator used a size in 0–50 and 32-bit fractions;
it did not sample arbitrary IEEE doubles. Filtered generators also grew their
size after repeated rejection. Replacing them with generic finite doubles or
fixed bounded filters changes their domain and behavior.

A trial migration exposed fixed-absolute-tolerance inverse round-trip failures
for near-singular transforms. Two recorded coefficient/input examples are:

| Operation | Affine coefficients `(m00,m01,m02,m10,m11,m12)` | Input |
| --- | --- | --- |
| Vector round-trip | `(-34,-34,-34,-34,-33.999999984167516,-34)` | `(0,-0.9999999986030161)` |
| Position round-trip | `(-27,-27,-27,-27,-26.999999987427145,-27)` | `(0,0)` |

The observed round-trip outputs were `(0,-1)` and
`(2.384185792125848e-7,0)`, respectively. These are evidence for numerical
conditioning/oracle investigation, not a demonstrated new runtime regression.
A simple componentwise residual bound also proved unsuitable for every
explicit-inverse position solve. The trial math migration and tentative oracle
changes were discarded; the checked-in math suite and runtime math remain
unchanged. The existing #138 deterministic composition counterexample and
extreme-scale checks remain covered.

Before migrating the math suite, choose and justify inverse/solve error checks
that distinguish conditioning from implementation errors, preserve the generated
domains and shrinking, and retain the recorded cases. Do not narrow generators
or discard difficult inputs merely to make the migration green.
