const { ethers } = require("ethers");
const { default: chalk } = require("chalk");
require("dotenv").config();
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout
});

const RPC_URL = "https://evmrpc-testnet.0g.ai/";
const CHAIN_ID = 16601;

const PRIVATE_KEYS = Object.entries(process.env)
  .filter(([key]) => key.startsWith("PRIVATE_KEY_"))
  .map(([, value]) => value)
  .filter(Boolean);

if (PRIVATE_KEYS.length === 0) {
  console.log(chalk.red("❌ Tidak ada PRIVATE_KEY yang ditemukan di .env"));
  process.exit(1);
}

const TOKENS = {
  USDT: { address: "0x3ec8a8705be1d5ca90066b37ba62c4183b024ebf", decimal: 18 },
  ETH: { address: "0x0fe9b43625fa7edd663adcec0728dd635e4abf7c", decimal: 18 },
  BTC: { address: "0x36f6414ff1df609214ddaba71c84f18bcf00f67d", decimal: 18 }
};
const ROUTER_ADDRESS = "0xb95b5953ff8ee5d5d9818cdbefe363ff2191318c";

const CONTRACT_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: "address", name: "tokenIn", type: "address" },
          { internalType: "address", name: "tokenOut", type: "address" },
          { internalType: "uint24", name: "fee", type: "uint24" },
          { internalType: "address", name: "recipient", type: "address" },
          { internalType: "uint256", name: "deadline", type: "uint256" },
          { internalType: "uint256", name: "amountIn", type: "uint256" },
          { internalType: "uint256", name: "amountOutMinimum", type: "uint256" },
          { internalType: "uint160", name: "sqrtPriceLimitX96", type: "uint160" }
        ],
        internalType: "struct ISwapRouter.ExactInputSingleParams",
        name: "params",
        type: "tuple"
      }
    ],
    name: "exactInputSingle",
    outputs: [{ internalType: "uint256", name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
    type: "function"
  }
];

const provider = new ethers.JsonRpcProvider(RPC_URL, {
  chainId: CHAIN_ID,
  name: "0g-testnet"
});

async function main() {
  console.log(chalk.yellow("\n🚀 Zer0 Exchange Auto-Swap Multi-Wallet Bot\n"));

  const swapCount = Number(await askQuestion("Masukkan jumlah swap per wallet (1-10): "));
  if (isNaN(swapCount) || swapCount < 1 || swapCount > 10) {
    console.log(chalk.red("Jumlah swap harus antara 1-10!"));
    process.exit(1);
  }

  for (let i = 0; i < PRIVATE_KEYS.length; i++) {
    const wallet = new ethers.Wallet(PRIVATE_KEYS[i], provider);
    const router = new ethers.Contract(ROUTER_ADDRESS, CONTRACT_ABI, wallet);

    console.log(chalk.cyan(`\n=== Wallet ${i + 1}/${PRIVATE_KEYS.length}: ${wallet.address} ===`));
    await showBalances(wallet);

    for (let j = 1; j <= swapCount; j++) {
      console.log(chalk.blue(`\n🔄 [Putaran ${j}/${swapCount}] Swap untuk wallet ${wallet.address}`));
      try {
        await swapTokens(wallet, router, "USDT", "ETH", ethers.parseUnits("1", TOKENS.USDT.decimal), `USDT → ETH`);
        await swapTokens(wallet, router, "USDT", "BTC", ethers.parseUnits("1", TOKENS.USDT.decimal), `USDT → BTC`);
        await swapTokens(wallet, router, "ETH", "USDT", ethers.parseUnits("0.01", TOKENS.ETH.decimal), `ETH → USDT`);
        await swapTokens(wallet, router, "ETH", "BTC", ethers.parseUnits("0.01", TOKENS.ETH.decimal), `ETH → BTC`);
        await swapTokens(wallet, router, "BTC", "USDT", ethers.parseUnits("0.0001", TOKENS.BTC.decimal), `BTC → USDT`);
        await swapTokens(wallet, router, "BTC", "ETH", ethers.parseUnits("0.0001", TOKENS.BTC.decimal), `BTC → ETH`);

        console.log(chalk.green(`✅ Semua swap berhasil untuk wallet ${wallet.address}`));
      } catch (error) {
        console.log(chalk.red(`❌ Gagal swap untuk wallet ${wallet.address}: ${error.message}`));
      }
    }

    await showBalances(wallet);
  }

  process.exit(0);
}

async function askQuestion(question) {
  return new Promise(resolve => readline.question(question, resolve));
}

async function showBalances(wallet) {
  console.log(chalk.yellow("\n💰 Saldo Wallet:"));

  const ogBalance = await provider.getBalance(wallet.address);
  console.log(`OG : ${ethers.formatUnits(ogBalance, 18)} OG`);

  for (const [symbol, token] of Object.entries(TOKENS)) {
    try {
      const contract = new ethers.Contract(
        token.address,
        ["function balanceOf(address) view returns (uint256)"],
        wallet
      );
      const balance = await contract.balanceOf(wallet.address);
      console.log(`${symbol}: ${ethers.formatUnits(balance, token.decimal)}`);
    } catch (error) {
      console.log(chalk.red(`Gagal cek saldo ${symbol}: ${error.message}`));
    }
  }
}

async function swapTokens(wallet, router, fromToken, toToken, amountIn, description) {
  const deadline = Math.floor(Date.now() / 1000) + 1200;
  const fee = 3000;
  const recipient = wallet.address;

  const tokenContract = new ethers.Contract(
    TOKENS[fromToken].address,
    [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)"
    ],
    wallet
  );

  const balance = await tokenContract.balanceOf(wallet.address);
  if (balance < amountIn) {
    throw new Error(`Saldo ${fromToken} tidak cukup`);
  }

  if (fromToken !== "ETH") {
    const allowance = await tokenContract.allowance(wallet.address, ROUTER_ADDRESS);
    if (allowance < amountIn) {
      console.log(chalk.yellow(`Approval ${fromToken}...`));
      const tx = await tokenContract.approve(ROUTER_ADDRESS, amountIn);
      await tx.wait();
      console.log(chalk.green(`Approval ${fromToken} sukses`));
    }
  }

  try {
    console.log(chalk.yellow(`Swap ${description}...`));
    const params = {
      tokenIn: TOKENS[fromToken].address,
      tokenOut: TOKENS[toToken].address,
      fee,
      recipient,
      deadline,
      amountIn,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0
    };

    const gasPrice = (await provider.getFeeData()).gasPrice || ethers.parseUnits("10", "gwei");
    const tx = await router.exactInputSingle(params, {
      gasLimit: 500000,
      gasPrice
    });

    console.log(chalk.blue(`Tx terkirim: ${tx.hash}`));
    const receipt = await tx.wait(2);

    if (receipt.status === 1) {
      console.log(chalk.green(`✔ ${description} berhasil! Tx: ${tx.hash}`));
    } else {
      throw new Error("Transaksi gagal");
    }
  } catch (error) {
    console.error(chalk.red("Detail error:"), error);
    throw new Error(`Swap ${description} gagal: ${error.reason || error.message}`);
  }

  const delaySeconds = Math.floor(Math.random() * 11 + 7); // 7–17 detik
  console.log(chalk.blue(`Menunggu ${delaySeconds} detik sebelum swap berikutnya...`));
  await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
}

// Jalankan
main().catch(error => {
  console.error("❌ Error utama:", error);
  process.exit(1);
});
