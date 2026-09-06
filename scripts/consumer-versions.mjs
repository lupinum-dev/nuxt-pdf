const frameworkPackages = ['nuxt', 'vue', 'pdfjs-dist', '@napi-rs/canvas']
const compare = (left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]

export function consumerVersions(peers, current) {
  const minimum = { ...current }
  for (const name of frameworkPackages) {
    const ranges = peers[name]?.split(' || ').map(range => range.match(/^\^(\d+)\.(\d+)\.(\d+)$/))
    if (!ranges?.length || ranges.some(range => !range)) {
      throw new Error(`Define a consumer profile for unsupported ${name} peer range: ${peers[name]}`)
    }
    const floors = ranges.map(range => range.slice(1).map(Number))
    const installed = current[name]?.match(/^(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
    if (!installed || !floors.some((floor) => {
      const upper = floor[0] ? [floor[0] + 1, 0, 0] : floor[1] ? [0, floor[1] + 1, 0] : [0, 0, floor[2] + 1]
      return compare(installed, floor) >= 0 && compare(installed, upper) < 0
    })) throw new Error(`Installed ${name}@${current[name]} is outside the declared peer range.`)
    minimum[name] = floors.sort(compare)[0].join('.')
  }
  return frameworkPackages.every(name => minimum[name] === current[name])
    ? [{ name: 'current', versions: current }]
    : [{ name: 'minimum', versions: minimum }, { name: 'current', versions: current }]
}
