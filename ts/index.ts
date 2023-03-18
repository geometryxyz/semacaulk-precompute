#!/usr/bin/env node
import 'source-map-support/register'
import * as argparse from 'argparse' 
import * as assert from 'assert'
import * as path from 'path'
import * as fs from 'fs'
import * as ethers from 'ethers'

let rootDir = path.join(__dirname, '..')
const { version } = require(path.join(rootDir, 'package.json'))

const validateEthAddress = (address: string) => {
    return address.match(/^0x[a-fA-F0-9]{40}$/) != null
}

const validateNum = (num: number, errorMsg: string, minimumInclusive: number = 0): boolean => {
    if (num < minimumInclusive || Math.floor(num) != num) {
        console.error(errorMsg)
        return false
    }
    return true
}

const run = async () => {
    const parser = new argparse.ArgumentParser({
        description: 'Monitor a Semacaulk contract, precompute data, and update a Blyss bucket.'
    })
    parser.add_argument('-v', '--version', { action: 'version', version });
    parser.add_argument('-r', '--rpc', { action: 'store', type: String, default: 'http://127.0.0.1:8545', help: 'The Ethereum RPC to connect to' });
    parser.add_argument('-c', '--contract', { action: 'store', type: String, required: true, help: 'The address fo the Semacaulk contract' });
    parser.add_argument('-f', '--finality', { action: 'store', type: Number, default: 0, help: 'The number of blocks behind the chain tip to consider it final' });
    parser.add_argument('-i', '--interval', { action: 'store', type: Number, default: 5000, help: 'The number of ms for each main loop iteration' });
    parser.add_argument('-m', '--main-blocks-per-query', { action: 'store', type: Number, default: 1000, help: 'The number of blocks per query in the main loop' });
    parser.add_argument('-n', '--initial-blocks-per-query', { action: 'store', type: Number, default: 1000, help: 'The number of blocks per query for the inital log-download step' });
    parser.add_argument('-q', '--initial-query-interval', { action: 'store', type: Number, default: 50, help: 'The number of ms per loop iteration for the initial download step' });
 
    const args = parser.parse_args()

    if (!validateEthAddress(args.contract)) {
        console.error('Error: invalid value for -c/--contract; should be a valid Ethereum contract address')
        return
    }

    if (!validateNum(
        args.finality,
        'Error: invalid value for -f/--finality; must be a non-negative integer (number of blocks)',
        0
    )) { return }

    if (!validateNum(
        args.interval,
        'Error: invalid value for -i/--interval; must be a positive integer (ms)',
        1
    )) { return }

    if (!validateNum(
        args.main_blocks_per_query,
        'Error: invalid value for -m/--main-blocks-per-query; must be a positive integer (ms)',
        1
    )) { return }

    if (!validateNum(
        args.initial_blocks_per_query,
        'Error: invalid value for -n/--inital-blocks-per-query; must be a positive integer (ms)',
        1
    )) { return }

    if (!validateNum(
        args.initial_query_interval,
        'Error: invalid value for -q/--query-interval; must be a positive integer (ms)',
        1
    )) { return }

    // Get Semacaulk ABI
    const semacaulkPath = path.join('__dirname', '..', 'Semacaulk.abi.json')
	const semacaulkAbi = JSON.parse(
		fs.readFileSync(semacaulkPath).toString()
	).abi

    let provider
    let contract

    try {
        // Connect to the Semacaulk contract
        provider = new ethers.providers.JsonRpcProvider(args.rpc)
        contract = new ethers.Contract(
            args.contract,
            semacaulkAbi,
            provider,
        )

        // Sanity-check the contract
        let result = await contract.getCurrentIndex()
        assert(result >= 0)
    } catch (e) {
        console.error(e)
        console.error('Could not connect to the Semacaulk contract at', args.contract)
    }
    
    // Fetch event logs up to the current block number
    const currentBlockNum = await contract.provider.getBlockNumber() - args.finality
    const logs = await fetchInitialLogs(
        contract,
        currentBlockNum === 0 ? 0 : currentBlockNum - 1,
        args.initial_blocks_per_query,
        args.initial_query_interval,
    )

    // TODO: do something with the logs!
    
    let startBlockNum = currentBlockNum
    for (const log of logs) {
        const b = log.blockNumber + 1
        if (b > startBlockNum) {
            startBlockNum = b
        }
    }

    // Start the main loop to monitor the contract
    await mainLoop(contract, startBlockNum, args.main_blocks_per_query, args.finality, args.interval)
}

const fetchInitialLogs = async (
    contract: ethers.Contract,
    currentBlockNum: number,
    blocksPerQuery: number,
    interval: number,
) => {
    let allLogs: any = []
    let fromBlock = 0
    let toBlock = fromBlock + blocksPerQuery

    while (true) {
        if (fromBlock > currentBlockNum) {
            break
        }

        const start = Date.now()

        const logs = await contract.provider.getLogs({
            ...contract.filters.InsertIdentity(),
            fromBlock,
            toBlock,
        })

        // Sleep until the interval is over if there is still time left
        const end = Date.now()
        const elapsed = end - start
        const timeLeft = interval - elapsed
        console.log('In fetchInitialLogs. Fetched', logs.length, 'logs')
        console.log('fromBlock:', fromBlock, 'toBlock:', toBlock)
        console.log('Took', elapsed, 'ms ----------\n')
        if (timeLeft > 0) {
            await delay(interval)
        }
        fromBlock = toBlock + 1
        toBlock = fromBlock + blocksPerQuery

        allLogs = [...allLogs, ...logs]
    }

    return allLogs
}

// TODO: refactor
const mainLoop = async (
    contract: ethers.Contract,
    startBlockNum: number,
    blocksPerQuery: number,
    finality: number,
    interval: number,
) => {
    let fromBlock = startBlockNum
    let toBlock = fromBlock + blocksPerQuery

    while (true) {
        const start = Date.now()

        let shouldFetch = true

        // Fetch block number
        const currentBlockNum = await contract.provider.getBlockNumber() - finality

        // Don't do anything if fromBlock is greater than currentBlockNum
        shouldFetch = shouldFetch && fromBlock <= currentBlockNum

        console.log('In main loop.')
        if (shouldFetch) {

            if (toBlock > currentBlockNum) {
                toBlock = currentBlockNum
            }
            const logs = await contract.provider.getLogs({
                ...contract.filters.InsertIdentity(),
                fromBlock,
                toBlock,
            })
            if (logs.length) {
                console.log('Fetched', logs.length, 'logs')
                // TODO: do something with the logs!
            }
        }
        console.log('currentBlockNum:', currentBlockNum)
        console.log('shouldFetch:', shouldFetch, 'startBlockNum:', startBlockNum)
        console.log('fromBlock:', fromBlock, 'toBlock:', toBlock)
        console.log()

        // Sleep until the interval is over if there is still time left
        const end = Date.now()
        const elapsed = end - start
        const timeLeft = interval - elapsed
        if (timeLeft > 0) {
            await delay(interval)
        }

        // Update fromBlock and toBlock
        if (fromBlock <= currentBlockNum) {
            fromBlock += blocksPerQuery
            toBlock += blocksPerQuery
        }
    }
}

const delay = (ms: number): Promise<void> => {
    return new Promise((resolve: Function) => setTimeout(resolve, ms))
}

if (require.main === module) {
    run()
}
