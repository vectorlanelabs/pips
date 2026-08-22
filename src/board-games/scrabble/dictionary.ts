// DAWG (Directed Acyclic Word Graph) node structure for efficient word storage
interface DAWGNode {
  [letter: string]: number | boolean  // child node index (number) or isWord (boolean as 'end')
}

export interface ScrabbleDictionary {
  isWord(word: string): boolean
}

// Deserialize a DAWG from the compact JSON format
function deserializeDAWG(data: Array<Record<string, number | boolean>>): DAWGNode[] {
  return data as DAWGNode[]
}

export async function loadDictionary(): Promise<ScrabbleDictionary> {
  const response = await fetch('/dictionary/enable1.dawg.json')
  if (!response.ok) {
    throw new Error(`Failed to load dictionary: ${response.statusText}`)
  }
  const data = await response.json() as Array<Record<string, number | boolean>>
  const nodes = deserializeDAWG(data)

  function isWord(word: string): boolean {
    let nodeIdx = 0
    const upper = word.toUpperCase()

    for (const char of upper) {
      const node = nodes[nodeIdx]
      if (!node) return false

      const next = node[char]
      if (typeof next === 'number') {
        nodeIdx = next
      } else {
        return false
      }
    }

    const finalNode = nodes[nodeIdx]
    return finalNode && finalNode.end === true
  }

  return { isWord }
}
