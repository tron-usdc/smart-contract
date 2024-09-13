const { ethers } = require("hardhat");

async function generateCalldata(functionSignature, ...params) {
  // 解析函数签名以获取参数类型
  const [name, types] = functionSignature.slice(0, -1).split('(');
  const paramTypes = types.split(',');

  // 确保参数数量匹配
  if (paramTypes.length !== params.length) {
    throw new Error("Parameter count mismatch");
  }

  const abiCoder = new ethers.AbiCoder();

  // 使用解析出的类型进行编码
  const encodedParams = abiCoder.encode(paramTypes, params);
  
  const functionSelector = ethers.id(functionSignature).slice(0, 10);
  return functionSelector + encodedParams.slice(2);
}

module.exports = {
  generateCalldata
};