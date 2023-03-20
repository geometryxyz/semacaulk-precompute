#!/usr/bin/env node
import { Bucket } from '@blyss/sdk'
const blyss = require('@blyss/sdk/node')
process.removeAllListeners('warning')

const run = async () => {
    const bucket: Bucket = await blyss.Bucket.initializeLocal(
        'http://localhost:8008'
    )
    const toWrite = {}
    toWrite['0'] = '38fd84ec507925f38285bdf189cc973d68772fd8010c8de783a9c2092c4b4d2a33cb24ae7197f6161ce4a034eef40d110597ef9185e15792264fdf51549db014c2a850c52a7d3498614bfecac9f507d0a1f3c5864a5328f0f924a1456a300b028874fd27b5bc73302576b5dd9bd98c65648b9f3a7720f82b276764addd6efe1700'

    console.log(toWrite)
    await bucket.write(toWrite)
    console.log(await bucket.privateRead('0'))
}

if (require.main === module) {
    run()
}
