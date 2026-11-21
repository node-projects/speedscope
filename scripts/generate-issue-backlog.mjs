import {readFileSync, writeFileSync} from 'node:fs'

const data = JSON.parse(readFileSync('docs/issue-backlog.json', 'utf8'))
const issues = data.issues
if (data.inventoryCheckedOn && !/^\d{4}-\d{2}-\d{2}$/.test(data.inventoryCheckedOn))
  throw new Error('Invalid upstream inventory check date')
const ids = new Set()
for (const issue of issues) {
  if (
    !Number.isInteger(issue.id) ||
    ids.has(issue.id) ||
    issue.url !== `https://github.com/jlfwong/speedscope/issues/${issue.id}`
  )
    throw new Error(`Invalid or duplicate issue ${issue.id}`)
  ids.add(issue.id)
  if (
    !['bug', 'feature', 'maintenance'].includes(issue.kind) ||
    !['yes', 'conditional', 'no'].includes(issue.usefulness) ||
    ![
      'implemented',
      'supported',
      'partial',
      'planned',
      'needs-reproduction',
      'declined',
      'obsolete',
    ].includes(issue.status) ||
    !['P1', 'P2', 'P3', 'none'].includes(issue.priority) ||
    !issue.evidence ||
    !issue.remaining
  )
    throw new Error(`Incomplete classification for #${issue.id}`)
}
const statuses = [
  'implemented',
  'supported',
  'partial',
  'planned',
  'needs-reproduction',
  'declined',
  'obsolete',
]
let output = `# Upstream issue backlog\n\n**We have not fixed every speedscope issue.** This inventory covers all **${issues.length} open upstream issues** checked on ${data.reviewedOn}. It does not claim to audit closed issues or close upstream reports.\n\nSource: [upstream issues](${data.source}). [Machine-readable classifications](issue-backlog.json) · [Detailed review evidence](UPSTREAM_ISSUE_REVIEW.md) · [Performance work](LARGE_TRACE_PERFORMANCE.md).\n\n## Summary\n\n| Kind | Implemented | Already supported | Partial | Planned | Needs reproduction | Declined | Obsolete | Total |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n`
if (data.inventoryCheckedOn)
  output = output.replace(
    '\n\nSource:',
    `\n\nOpen-issue IDs were rechecked on ${data.inventoryCheckedOn}; this is an inventory check, not a fresh review of every discussion.\n\nSource:`,
  )
for (const kind of ['bug', 'feature', 'maintenance']) {
  const rows = issues.filter(i => i.kind === kind)
  output += `| ${kind} | ${statuses
    .map(status => rows.filter(i => i.status === status).length)
    .join(' | ')} | ${rows.length} |\n`
}
output += `\n**Implemented** means the reviewed scope has an implementation. **Supported** means it already works or the established format is supported. **Partial** never means fully fixed. **Needs reproduction** means insufficient current evidence. A useful proposal can remain planned because it needs substantial design, fixtures or validation.\n\nP1: correctness/large-profile failures. P2: valuable product work. P3: lower-priority maintenance, integration or presentation. These priorities are engineering judgments, not upstream labels. Useful architectural work still includes broader worker coverage, streaming import, signed-input imports and synchronized tracks.\n\n`
const escape = value => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const sections = [
  ['Remaining useful bugs', i => i.kind === 'bug' && ['partial', 'planned'].includes(i.status)],
  [
    'Remaining useful features',
    i => i.kind === 'feature' && ['partial', 'planned'].includes(i.status),
  ],
  [
    'Remaining maintenance',
    i => i.kind === 'maintenance' && ['partial', 'planned'].includes(i.status),
  ],
  ['Need a current reproduction', i => i.status === 'needs-reproduction'],
  ['Implemented or already supported', i => ['implemented', 'supported'].includes(i.status)],
  ['Not selected or obsolete', i => ['declined', 'obsolete'].includes(i.status)],
]
let count = 0
for (const [title, include] of sections) {
  const rows = issues
    .filter(include)
    .sort((a, b) => a.priority.localeCompare(b.priority) || b.id - a.id)
  output += `## ${title} (${rows.length})\n\n| Issue | Kind | Useful? | Status | Priority | Work / evidence |\n| --- | --- | --- | --- | --- | --- |\n`
  for (const issue of rows) {
    count++
    const done = ['implemented', 'supported'].includes(issue.status)
    output += `| [#${issue.id}](${issue.url}) ${escape(issue.title)} | ${issue.kind} | ${
      issue.usefulness
    } | ${issue.status} | ${issue.priority} | ${escape(
      done ? issue.evidence : issue.remaining,
    )} |\n`
  }
  output += '\n'
}
if (count !== issues.length)
  throw new Error('Backlog sections do not cover every issue exactly once')
output += `## Maintaining this list\n\nEdit \`docs/issue-backlog.json\` when implementation or evidence changes, then run \`npm run backlog:generate\`. \`npm run backlog:check\` validates classifications and generated output. Keep partially implemented requests open in this list until their remaining scope is actually addressed. The narrative review retains historical measurements; this file is the current classification.\n`
if (process.argv.includes('--check')) {
  if (readFileSync('docs/ISSUE_BACKLOG.md', 'utf8') !== output)
    throw new Error('Run npm run backlog:generate to update the backlog')
} else writeFileSync('docs/ISSUE_BACKLOG.md', output)
console.log(`Validated ${issues.length} unique issue classifications`)
