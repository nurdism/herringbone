/**
 * A very small Markdown renderer, sized exactly to what the build notes use:
 * headings, tables, lists, blockquotes, fenced code, bold and inline code.
 * Not a general parser, and deliberately so.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
}

const isTableSep = (l: string) => /^\|[\s:|-]+\|$/.test(l.trim())

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++])
      i++
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }

    const head = /^(#{1,4})\s+(.*)$/.exec(line)
    if (head) {
      const n = head[1].length
      out.push(`<h${n}>${inline(head[2])}</h${n}>`)
      i++
      continue
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue }

    // table: a pipe row followed by a separator row
    if (line.trim().startsWith('|') && isTableSep(lines[i + 1] ?? '')) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const header = cells(line)
      i += 2
      const body: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) body.push(cells(lines[i++]))
      const hasHeader = header.some((c) => c.length)
      out.push(
        '<table>' +
          (hasHeader ? `<thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : '') +
          `<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>` +
          '</table>',
      )
      continue
    }

    if (line.trim().startsWith('>')) {
      const buf: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) buf.push(lines[i++].trim().replace(/^>\s?/, ''))
      out.push(`<blockquote>${buf.filter((l) => l.length).map((l) => `<p>${inline(l)}</p>`).join('')}</blockquote>`)
      continue
    }

    const ordered = /^\s*\d+\.\s+/.test(line)
    const bullet = /^\s*[-*]\s+/.test(line)
    if (ordered || bullet) {
      const tag = ordered ? 'ol' : 'ul'
      const items: string[] = []
      while (i < lines.length && /^\s*(\d+\.|[-*])\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*(\d+\.|[-*])\s+/, ''))
      }
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`)
      continue
    }

    if (!line.trim()) { i++; continue }

    const buf: string[] = []
    while (
      i < lines.length && lines[i].trim() &&
      !lines[i].startsWith('#') && !lines[i].startsWith('```') &&
      !lines[i].trim().startsWith('>') && !lines[i].trim().startsWith('|') &&
      !/^\s*(\d+\.|[-*])\s+/.test(lines[i])
    ) buf.push(lines[i++])
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }

  return out.join('\n')
}
