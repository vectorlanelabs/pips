import * as fs from 'fs'
import * as path from 'path'

// Build a DAWG (Directed Acyclic Word Graph) from the ENABLE1 word list
// The ENABLE1 list is public domain: http://www.puzzlers.org/

interface DAWGNode {
  [key: string]: number | boolean
}

// Fetch or load the ENABLE1 word list from a public source
async function fetchENABLE1Words(): Promise<string[]> {
  // Try to fetch from a public source
  try {
    const response = await fetch('http://www.puzzlers.org/pub/wordlists/enable1.txt')
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const text = await response.text()
    return text.split('\n').map((w) => w.trim().toUpperCase()).filter((w) => w.length > 0)
  } catch (err) {
    console.error('Failed to fetch ENABLE1 from public source, trying fallback...')
    // Fallback: create a minimal word list for testing
    // In production, manually download and vendor the file
    return []
  }
}

// Check if ENABLE1 exists locally
function loadLocalENABLE1(): string[] | null {
  const possiblePaths = [
    path.join(process.cwd(), 'enable1.txt'),
    path.join(process.cwd(), 'scripts', 'enable1.txt'),
  ]

  for (const filePath of possiblePaths) {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, 'utf-8')
      return text.split('\n').map((w) => w.trim().toUpperCase()).filter((w) => w.length > 0)
    }
  }
  return null
}

// Build a trie and convert to DAWG
function buildDAWG(words: string[]): DAWGNode[] {
  interface TrieNode {
    children: Map<string, TrieNode>
    isEnd: boolean
    signature?: string
    nodeIndex?: number
  }

  // Build trie first
  const root: TrieNode = { children: new Map(), isEnd: false }

  for (const word of words) {
    let node = root
    for (const char of word) {
      if (!node.children.has(char)) {
        node.children.set(char, { children: new Map(), isEnd: false })
      }
      node = node.children.get(char)!
    }
    node.isEnd = true
  }

  // Convert trie to DAWG by identifying identical subtrees
  // Calculate signatures for each node (bottom-up)
  function getSignature(node: TrieNode): string {
    const parts: string[] = []
    if (node.isEnd) parts.push('END')
    for (const [char, child] of node.children) {
      parts.push(`${char}:${getSignature(child)}`)
    }
    return `{${parts.join(',')}}`
  }

  // Map signatures to node indices to dedup identical subtrees
  const signatureToIndex = new Map<string, number>()
  const nodes: DAWGNode[] = []

  function nodeToDAWG(node: TrieNode): number {
    const sig = getSignature(node)
    if (signatureToIndex.has(sig)) {
      return signatureToIndex.get(sig)!
    }

    const nodeIdx = nodes.length
    signatureToIndex.set(sig, nodeIdx)

    const dawgNode: DAWGNode = {}
    if (node.isEnd) {
      dawgNode.end = true
    }
    nodes.push(dawgNode)

    for (const [char, child] of node.children) {
      dawgNode[char] = nodeToDAWG(child)
    }

    return nodeIdx
  }

  nodeToDAWG(root)
  return nodes
}

async function main() {
  console.log('Building Scrabble dictionary...')

  let words = loadLocalENABLE1()
  if (!words || words.length === 0) {
    console.log('No local ENABLE1 found, attempting to fetch...')
    words = await fetchENABLE1Words()
  }

  if (!words || words.length === 0) {
    console.error('Failed to load ENABLE1 word list.')
    console.error('Please download enable1.txt from http://www.puzzlers.org/pub/wordlists/enable1.txt')
    console.error('and place it in the repo root or scripts/ directory.')
    process.exit(1)
  }

  console.log(`Loaded ${words.length} words`)

  // Filter to valid Scrabble words (letters only, reasonable length)
  const validWords = words.filter((w) => /^[A-Z]+$/.test(w) && w.length > 0 && w.length <= 15)
  console.log(`Filtered to ${validWords.length} valid Scrabble words`)

  // Build DAWG
  const dawg = buildDAWG(validWords)
  console.log(`Built DAWG with ${dawg.length} nodes`)

  // Serialize to JSON
  const json = JSON.stringify(dawg)
  const outPath = path.join(process.cwd(), 'public', 'dictionary', 'enable1.dawg.json')

  // Ensure directory exists
  const dir = path.dirname(outPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  fs.writeFileSync(outPath, json, 'utf-8')

  const sizeKB = json.length / 1024
  console.log(`Wrote ${outPath}`)
  console.log(`Size: ${sizeKB.toFixed(1)} KB (uncompressed)`)

  // Try to estimate gzipped size
  try {
    const zlib = await import('zlib')
    const compressed = zlib.gzipSync(json)
    const sizeKBGz = compressed.length / 1024
    console.log(`Size: ${sizeKBGz.toFixed(1)} KB (gzipped)`)
  } catch {
    console.log('(Unable to estimate gzipped size)')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
