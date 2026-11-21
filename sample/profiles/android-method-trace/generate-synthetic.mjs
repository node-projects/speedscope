// Independently authored fixture in AOSP's classic key + SLOW v3 format.
import {writeFileSync} from 'node:fs'
const key = `*version
3
clock=dual
data-file-overflow=false
num-method-calls=6
*threads
1\tmain
513\tworker
*methods
0x4\tcom/example/Main\trun\t()V\tMain.java\t12
0x8\tcom/example/Main\twork\t(I)V\tMain.java\t24
0xc\tcom/example/Main\twork\t()V\tMain.java\t25
*end
`
// [thread, method/action, CPU microseconds, wall microseconds].
const records = [
  [1, 4, 0, 10],
  [513, 12, 0, 5],
  [1, 8, 5, 20],
  [1, 9, 10, 35],
  [513, 13, 7, 25],
  [1, 5, 20, 50],
]
const binary = Buffer.alloc(32 + records.length * 14)
binary.write('SLOW')
binary.writeUInt16LE(3, 4)
binary.writeUInt16LE(32, 6)
binary.writeUInt16LE(14, 16)
for (let i = 0; i < records.length; i++) {
  const [thread, method, cpu, wall] = records[i],
    offset = 32 + i * 14
  binary.writeUInt16LE(thread, offset)
  binary.writeUInt32LE(method, offset + 2)
  binary.writeUInt32LE(cpu, offset + 6)
  binary.writeUInt32LE(wall, offset + 10)
}
writeFileSync(
  new URL('./synthetic-dual.trace', import.meta.url),
  Buffer.concat([Buffer.from(key), binary]),
)
