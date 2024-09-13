const ethers = require('ethers');

// 计算存储槽
function calculateStorageSlot() {
  // 步骤 1: 计算内部 keccak256 哈希
  const innerHash = ethers.keccak256(ethers.toUtf8Bytes("TronUSDC.storage.TronUSDCBridgeController"));

  // 步骤 2: 将哈希转换为 BigInt 并减 1
  const innerHashBigInt = BigInt(innerHash);
  const decrementedValue = innerHashBigInt - 1n;

  // 步骤 3: 将结果编码并再次进行 keccak256 哈希
  const encodedValue = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [decrementedValue.toString()]);
  const outerHash = ethers.keccak256(encodedValue);

  // 步骤 4: 将结果与 ~bytes32(uint256(0xff)) 进行按位与操作
  const mask = BigInt('0xff');
  const invertedMask = ~mask;
  const finalResult = BigInt(outerHash) & invertedMask;

  // 返回最终结果（十六进制字符串）
  return '0x' + finalResult.toString(16).padStart(64, '0');
}

// 执行计算并打印结果
const result = calculateStorageSlot();
console.log("计算结果:", result);