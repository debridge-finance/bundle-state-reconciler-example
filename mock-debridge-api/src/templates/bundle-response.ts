import { BundleRow, PaginatedBundlesResponse } from "../types";

/**
 * Static template extracted from prompts/bundle-by-id.payload.js.
 * Only bundleId, status, createdAt, updatedAt, and cancel are overridden at response time.
 */
export const BUNDLE_TEMPLATE = {
  bundleId: "b4409435-0bdb-412e-84ee-8a00db26e191",
  referralCode: "110000002",
  status: "fulfilled",
  isAtomic: true,
  tradingAlgorithm: "MARKET",
  trades: [
    {
      id: "694c08c17b2aae6565b44331",
      tradeId: "0xa953131995da0e33168d7c84d16716cd3b72851a779ff2c178ddd0b6b5c423da",
      intentId: "0x37952a8cad9e86313b90c0bedb6daba8aad3baf04f6cd0f085a46967ef5f5dc0",
      tokenIn: {
        chainId: 137,
        address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
        amount: "8494886",
        isWrapped: false,
        symbol: "USDC",
        decimals: 6,
        iconUrl: "https://tokens.debridge.finance/Logo/137/0x3c499c542cef5e3811e1192ce70d8cc03d5c3359/big/token-logo.png",
        usd: "8.492804981691906",
      },
      tokenOut: {
        chainId: 42161,
        address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        amount: "6991603",
        minAmount: "6991603",
        symbol: "USDC",
        decimals: 6,
        iconUrl: "https://tokens.debridge.finance/Logo/42161/0xaf88d065e77c8cc2239327c5edb3a432268e5831/big/token-logo.png",
        usd: "6.989890245544447",
      },
      receiverAddress: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
      srcAuthorityAddress: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
      dstAuthorityAddress: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
      externalCall: null,
      status: "fulfilled",
      executedSrc: true,
      executedDst: true,
      finalizedSrc: true,
      finalizedDst: true,
      finalizedBlockSrc: "80735714",
      finalizedBlockDst: "414053208",
      subtrades: [
        {
          id: "0xa953131995da0e33168d7c84d16716cd3b72851a779ff2c178ddd0b6b5c423da",
          status: "fulfilled",
          tokenInAmount: "8494886",
          tokenOutAmount: "6991603",
          tokenOutMinAmount: "6991603",
          orderId: "0xffe5e8e0f8a80d54a3ff9775b159b0e46d4f831da76d4e69e39c04b8d2006281",
          createdAt: "2025-12-24T15:37:38.020Z",
        },
      ],
    },
    {
      id: "694c08c17b2aae6565b44332",
      tradeId: "0xc71f03252348827b0cfb16ff877f310b8a9a26d8c6a384ee4fca5b88ce9661e6",
      intentId: "0x37952a8cad9e86313b90c0bedb6daba8aad3baf04f6cd0f085a46967ef5f5dc0",
      tokenIn: {
        chainId: 137,
        address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
        amount: "100000000000000000",
        isWrapped: true,
        symbol: "WPOL",
        decimals: 18,
        iconUrl: "https://tokens.debridge.finance/Logo/137/0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270/big/token-logo.png",
        usd: "0.010674431567313437",
      },
      tokenOut: {
        chainId: 42161,
        address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        amount: "10493",
        minAmount: "10493",
        symbol: "USDC",
        decimals: 6,
        iconUrl: "https://tokens.debridge.finance/Logo/42161/0xaf88d065e77c8cc2239327c5edb3a432268e5831/big/token-logo.png",
        usd: "0.010490429497569854",
      },
      receiverAddress: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
      srcAuthorityAddress: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
      dstAuthorityAddress: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
      externalCall: null,
      status: "fulfilled",
      executedSrc: true,
      executedDst: true,
      finalizedSrc: true,
      finalizedDst: true,
      finalizedBlockSrc: "80735714",
      finalizedBlockDst: "414053208",
      subtrades: [
        {
          id: "0xc71f03252348827b0cfb16ff877f310b8a9a26d8c6a384ee4fca5b88ce9661e6",
          status: "fulfilled",
          tokenInAmount: "100000000000000000",
          tokenOutAmount: "10493",
          tokenOutMinAmount: "10493",
          orderId: "0xd40851eab91fc43afdf31c8fab25fb59138ac6e84cee26d5e4f96c0668924392",
          createdAt: "2025-12-24T15:37:38.020Z",
        },
      ],
    },
  ],
  intents: [
    {
      intentId: "0x37952a8cad9e86313b90c0bedb6daba8aad3baf04f6cd0f085a46967ef5f5dc0",
      requiredActions: [
        {
          type: 3,
          actions: [4],
          data: {
            eip712Data: null,
            delegateData: null,
            userOp: {
              data: {
                domain: {
                  name: "DelegationManager",
                  version: "1",
                  chainId: 137,
                  verifyingContract: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
                },
                types: {
                  Caveat: [
                    { name: "enforcer", type: "address" },
                    { name: "terms", type: "bytes" },
                  ],
                  Delegation: [
                    { name: "delegate", type: "address" },
                    { name: "delegator", type: "address" },
                    { name: "authority", type: "bytes32" },
                    { name: "caveats", type: "Caveat[]" },
                    { name: "salt", type: "uint256" },
                  ],
                },
                primaryType: "Delegation",
                message: {
                  delegate: "0xE547d2EeD6DD60796013b485D284C17Da1194C82",
                  delegator: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
                  authority: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                  caveats: [
                    {
                      enforcer: "0x146713078D39eCC1F5338309c28405ccf85Abfbb",
                      terms: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270000000000000000000000000000000000000000000000000016345785d8a0000d0e30db0",
                      args: "0x",
                    },
                    {
                      enforcer: "0xC8B5D93463c893401094cc70e66A206fb5987997",
                      terms: "0x000000000000000000000000000000002d0878ec87ed46159b8632c4d3d6b80d",
                      args: "0x",
                    },
                  ],
                  salt: "0",
                  signature: "0x",
                },
              },
              calls: [
                {
                  to: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
                  data: "0xd0e30db0",
                  value: "100000000000000000",
                },
              ],
            },
            txCall: null,
            solanaCall: null,
          },
          signedData: "0x74d6fe5343c422999b813e1531d035664182bbfce9e08c61e5ff7d06e87b0eb92b16a8a2831634948c37fa31dcd393ec72ad59186a0412a671dc05f45da7ea301c",
          gasPayment: null,
        },
        {
          type: 3,
          actions: [2],
          data: {
            eip712Data: null,
            delegateData: null,
            userOp: {
              data: {
                domain: {
                  name: "DelegationManager",
                  version: "1",
                  chainId: 137,
                  verifyingContract: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
                },
                types: {
                  Caveat: [
                    { name: "enforcer", type: "address" },
                    { name: "terms", type: "bytes" },
                  ],
                  Delegation: [
                    { name: "delegate", type: "address" },
                    { name: "delegator", type: "address" },
                    { name: "authority", type: "bytes32" },
                    { name: "caveats", type: "Caveat[]" },
                    { name: "salt", type: "uint256" },
                  ],
                },
                primaryType: "Delegation",
                message: {
                  delegate: "0xE547d2EeD6DD60796013b485D284C17Da1194C82",
                  delegator: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
                  authority: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                  caveats: [
                    {
                      enforcer: "0x146713078D39eCC1F5338309c28405ccf85Abfbb",
                      terms: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf12700000000000000000000000000000000000000000000000000000000000000000095ea7b3000000000000000000000000ddddddddd4b6472c5002f95610b194d1161223d0000000000000000000000000000000000000000000000000016345785d8a0000",
                      args: "0x",
                    },
                    {
                      enforcer: "0xC8B5D93463c893401094cc70e66A206fb5987997",
                      terms: "0x000000000000000000000000000000002329b42f7348422bb3aacee122d2a649",
                      args: "0x",
                    },
                  ],
                  salt: "0",
                  signature: "0x",
                },
              },
              calls: [
                {
                  to: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
                  data: "0x095ea7b3000000000000000000000000ddddddddd4b6472c5002f95610b194d1161223d0000000000000000000000000000000000000000000000000016345785d8a0000",
                  value: "0",
                },
              ],
            },
            txCall: null,
            solanaCall: null,
          },
          signedData: "0x79478ce425845d678e901ee75022acfe76aafb33ca6ce6e65ae743979fe85b586466e810903f9c60e859dbaa468c467b054a23aa8a683274c116278fdc7e57411c",
          gasPayment: null,
        },
        {
          type: 3,
          actions: [2],
          data: {
            eip712Data: null,
            delegateData: null,
            userOp: {
              data: {
                domain: {
                  name: "DelegationManager",
                  version: "1",
                  chainId: 137,
                  verifyingContract: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
                },
                types: {
                  Caveat: [
                    { name: "enforcer", type: "address" },
                    { name: "terms", type: "bytes" },
                  ],
                  Delegation: [
                    { name: "delegate", type: "address" },
                    { name: "delegator", type: "address" },
                    { name: "authority", type: "bytes32" },
                    { name: "caveats", type: "Caveat[]" },
                    { name: "salt", type: "uint256" },
                  ],
                },
                primaryType: "Delegation",
                message: {
                  delegate: "0xE547d2EeD6DD60796013b485D284C17Da1194C82",
                  delegator: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
                  authority: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                  caveats: [
                    {
                      enforcer: "0x146713078D39eCC1F5338309c28405ccf85Abfbb",
                      terms: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c33590000000000000000000000000000000000000000000000000000000000000000095ea7b3000000000000000000000000ddddddddd4b6472c5002f95610b194d1161223d00000000000000000000000000000000000000000000000000000000000819f26",
                      args: "0x",
                    },
                    {
                      enforcer: "0xC8B5D93463c893401094cc70e66A206fb5987997",
                      terms: "0x0000000000000000000000000000000049d266bbadd649da90af6ae417541742",
                      args: "0x",
                    },
                  ],
                  salt: "0",
                  signature: "0x",
                },
              },
              calls: [
                {
                  to: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
                  data: "0x095ea7b3000000000000000000000000ddddddddd4b6472c5002f95610b194d1161223d00000000000000000000000000000000000000000000000000000000000819f26",
                  value: "0",
                },
              ],
            },
            txCall: null,
            solanaCall: null,
          },
          signedData: "0x95270ad41a712cf8831b181e721ad9b8102f68139786fac631231be12a871fe74b7640ff747adc5fd731fe589857b2e6774b8844bc68484d3d24f994607f73cd1c",
          gasPayment: null,
        },
        {
          type: 2,
          actions: [3],
          data: {
            eip712Data: {
              domain: {
                name: "DeBridgeIntentManager",
                version: "1",
                chainId: 137,
                verifyingContract: "0xDDDDDDDdeB2E68Ee19832e356FCB5537124A9708",
              },
              types: {
                EIP712Domain: [
                  { name: "name", type: "string" },
                  { name: "version", type: "string" },
                  { name: "chainId", type: "uint256" },
                  { name: "verifyingContract", type: "address" },
                ],
                SignedIntent: [
                  { name: "intentId", type: "bytes32" },
                ],
              },
              primaryType: "SignedIntent",
              message: {
                intentId: "0x37952a8cad9e86313b90c0bedb6daba8aad3baf04f6cd0f085a46967ef5f5dc0",
              },
            },
            delegateData: null,
            userOp: null,
            txCall: null,
            solanaCall: null,
          },
          signedData: "0xd03f97e47e44b0fe0e5255fcb7aabf0fef58d04ccfd3db27608c4d69af8855287ad2ebaa5a9d80a21361c8fa5db19788c87ab667d6b44ebf2044a52faf2c36d71c",
          gasPayment: null,
        },
      ],
      intent: {
        receiverDetails: [
          {
            address: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
            chainIds: [42161],
          },
        ],
        inputToken: [
          {
            tokenAddress: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
            minPartialAmount: "0",
            maxPartialAmount: "100000000000000000",
            constraintBudget: "100000000000000000",
          },
          {
            tokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            minPartialAmount: "0",
            maxPartialAmount: "8494886",
            constraintBudget: "8494886",
          },
        ],
        intentTimestamp: 1766590644,
        expirationTimestamp: 3533181266,
        intentChainId: 137,
        giveToken: [
          {
            inputTokenAddress: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
            giveTokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            numerator: "105050",
            denominator: "18",
          },
          {
            inputTokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            giveTokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            numerator: "1000000",
            denominator: "6",
          },
        ],
        takeToken: [
          {
            fromTokenAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            takeTokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
            chainId: 42161,
            numerator: "823036",
            denominator: "6",
          },
        ],
        dstAuthorityAddresses: [
          {
            address: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
            chainIds: [42161],
          },
        ],
        intentOwner: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
        srcAllowedSender: ["0xE547d2EeD6DD60796013b485D284C17Da1194C82"],
        preInteractions: null,
        postInteractions: null,
        executionMetadataHash: null,
        dlnMetadata: null,
        externalCallHash: null,
        allowedCancelBeneficiary: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
        intentAuthority: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
        validationRules: null,
      },
      executionTxHash: "0x9024cbab2c068bf33302c164e6f8751e85c3fd12e13e5e61517595b28bfbaecb",
      executionTxChainId: 137,
      executedAt: "2025-12-24T15:37:51.000Z",
    },
  ],
  preHooks: [],
  postHooks: [
    {
      isAtomic: true,
      data: "0x617ba037000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e5831{amount}00000000000000000000000055a8f5cce1d53d9ff84ec0962882b447e5914db80000000000000000000000000000000000000000000000000000000000000000",
      to: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      value: "0",
      chainId: 42161,
      requiredActions: [
        {
          type: 3,
          actions: [2],
          data: {
            eip712Data: null,
            delegateData: null,
            userOp: {
              data: {
                domain: {
                  name: "DelegationManager",
                  version: "1",
                  chainId: 42161,
                  verifyingContract: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
                },
                types: {
                  Caveat: [
                    { name: "enforcer", type: "address" },
                    { name: "terms", type: "bytes" },
                  ],
                  Delegation: [
                    { name: "delegate", type: "address" },
                    { name: "delegator", type: "address" },
                    { name: "authority", type: "bytes32" },
                    { name: "caveats", type: "Caveat[]" },
                    { name: "salt", type: "uint256" },
                  ],
                },
                primaryType: "Delegation",
                message: {
                  delegate: "0xE547d2EeD6DD60796013b485D284C17Da1194C82",
                  delegator: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
                  authority: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                  caveats: [
                    {
                      enforcer: "0x146713078D39eCC1F5338309c28405ccf85Abfbb",
                      terms: "0xaf88d065e77c8cC2239327C5EDb3A432268e58310000000000000000000000000000000000000000000000000000000000000000095ea7b3000000000000000000000000794a61358d6845594f94dc1db02a252b5b4814ad00000000000000000000000000000000000000000000000000000000006ad7f0",
                      args: "0x",
                    },
                    {
                      enforcer: "0xC8B5D93463c893401094cc70e66A206fb5987997",
                      terms: "0x0000000000000000000000000000000051a4d24d07af48c8b6b4ee3dfc702060",
                      args: "0x",
                    },
                  ],
                  salt: "0",
                  signature: "0x",
                },
              },
              calls: [
                {
                  to: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
                  data: "0x095ea7b3000000000000000000000000794a61358d6845594f94dc1db02a252b5b4814ad00000000000000000000000000000000000000000000000000000000006ad7f0",
                  value: "0",
                },
              ],
            },
            txCall: null,
            solanaCall: null,
          },
          signedData: "0xbf862dc7bf4e0c34cb7d8826b54fdf333682015face2ee8beb478af3be75bf053a7063607dd1d0ae0ff904a27251fc8076ff8039fabab80730b3a6fff2ebdd4a1c",
          gasPayment: null,
        },
        {
          type: 3,
          actions: [5],
          data: {
            eip712Data: null,
            delegateData: null,
            userOp: {
              data: {
                domain: {
                  name: "DelegationManager",
                  version: "1",
                  chainId: 42161,
                  verifyingContract: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
                },
                types: {
                  Caveat: [
                    { name: "enforcer", type: "address" },
                    { name: "terms", type: "bytes" },
                  ],
                  Delegation: [
                    { name: "delegate", type: "address" },
                    { name: "delegator", type: "address" },
                    { name: "authority", type: "bytes32" },
                    { name: "caveats", type: "Caveat[]" },
                    { name: "salt", type: "uint256" },
                  ],
                },
                primaryType: "Delegation",
                message: {
                  delegate: "0xE547d2EeD6DD60796013b485D284C17Da1194C82",
                  delegator: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
                  authority: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                  caveats: [
                    {
                      enforcer: "0x146713078D39eCC1F5338309c28405ccf85Abfbb",
                      terms: "0x794a61358D6845594F94dc1DB02A252b5b4814aD0000000000000000000000000000000000000000000000000000000000000000617ba037000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e583100000000000000000000000000000000000000000000000000000000006ad7f000000000000000000000000055a8f5cce1d53d9ff84ec0962882b447e5914db80000000000000000000000000000000000000000000000000000000000000000",
                      args: "0x",
                    },
                    {
                      enforcer: "0xC8B5D93463c893401094cc70e66A206fb5987997",
                      terms: "0x0000000000000000000000000000000012e8c16c95ea4c4bba93dcc2e3c48bf7",
                      args: "0x",
                    },
                  ],
                  salt: "0",
                  signature: "0x",
                },
              },
              calls: [
                {
                  to: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
                  data: "0x617ba037000000000000000000000000af88d065e77c8cc2239327c5edb3a432268e583100000000000000000000000000000000000000000000000000000000006ad7f000000000000000000000000055a8f5cce1d53d9ff84ec0962882b447e5914db80000000000000000000000000000000000000000000000000000000000000000",
                  value: "0",
                },
              ],
            },
            txCall: null,
            solanaCall: null,
          },
          signedData: "0x4c2fbbdb80b802c9e082a9a5606d699eab27d009521b2bf80202adc49ec9444a69c51259e33695fa37d715812ddfd82b268857e3e6d9885444be38f46ab564be1b",
          gasPayment: null,
        },
      ],
      tokenAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      from: "0x55A8f5cce1d53D9Ff84EC0962882b447E5914dB8",
    },
  ],
  partnerCancelAuthority: [],
  userId: null,
  executedSrc: true,
  executedDst: false,
  finalizedSrc: true,
  finalizedDst: false,
  createdAt: "2025-12-24T15:37:37.994Z",
  updatedAt: "2026-01-06T20:21:32.356Z",
} as const;

export function buildBundleResponse(row: BundleRow): Record<string, unknown> {
  return {
    ...BUNDLE_TEMPLATE,
    bundleId: row.bundle_id,
    referralCode: row.referral_code ?? BUNDLE_TEMPLATE.referralCode,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    cancel: row.cancel ?? null,
  };
}

export function buildBundleListResponse(
  rows: BundleRow[],
  total: number,
  page: number,
  pageSize: number,
): PaginatedBundlesResponse {
  return {
    bundles: rows.map((row) => buildBundleResponse(row)),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
