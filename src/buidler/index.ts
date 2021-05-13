import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import chalk from 'chalk';
import { ethers } from 'ethers';
import { flatten, unflatten } from 'flat';

import {
  createContext,
  createParams,
  createResult,
  CreationStatus,
  EnvVariable,
  EnvVariables,
  HardhatOptions,
} from '../types';

const port = 8545;

// eslint-disable-next-line @typescript-eslint/ban-types
const prettyStringify = (obj: object): string => JSON.stringify(obj, null, 2);

const injectFlattenedJsonToFile = (
  file: string,
  // eslint-disable-next-line @typescript-eslint/ban-types
  options: object,
  // eslint-disable-next-line @typescript-eslint/ban-types
  maybeUnflattened?: object
) => {
  !fs.existsSync(file) && fs.writeFileSync(file, JSON.stringify({}));
  fs.writeFileSync(
    file,
    prettyStringify({
      ...unflatten({
        ...(flatten(
          JSON.parse(fs.readFileSync(file, 'utf-8'))
          // eslint-disable-next-line @typescript-eslint/ban-types
        ) as object),
        ...options,
      }),
      ...(typeof maybeUnflattened === 'object' ? maybeUnflattened : {}),
    })
  );
};

const createBaseProject = ({ name }: createParams) =>
  execSync(`npx create-react-native-app ${name} -t with-typescript`, {
    stdio: 'inherit',
  });

const ejectExpoProject = (ctx: createContext) => {
  const {
    bundleIdentifier, packageName, uriScheme,
  } = ctx;
  const { projectDir } = ctx;

  injectFlattenedJsonToFile(path.resolve(projectDir, 'app.json'), {
    'expo.ios.bundleIdentifier': bundleIdentifier,
    'expo.android.package': packageName,
    'expo.scheme': uriScheme,
    'expo.icon': 'assets/image/app-icon.png',
    'expo.splash.image': 'assets/image/app-icon.png',
    'expo.splash.resizeMode': 'contain',
    'expo.splash.backgroundColor': '#222222',
  });

  execSync(`cd ${projectDir}; expo eject --non-interactive`, {
    stdio: 'inherit',
  });

  const gradle = path.resolve(projectDir, 'android', 'gradle.properties');
  fs.writeFileSync(
    gradle,
    `
${fs.readFileSync(gradle, 'utf-8')}

# 4GB Heap Size
org.gradle.jvmargs=-Xmx4608m
    `.trim(),
  );
};

const setAppIcon = (ctx: createContext) => {
  const { projectDir } = ctx;
  const assetsDir = path.resolve(projectDir, 'assets');

  !fs.existsSync(assetsDir) && fs.mkdirSync(assetsDir);

  ['image', 'video', 'json', 'raw'].map((type: string) => {
    const dir = path.resolve(assetsDir, type);
    const gitkeep = path.resolve(dir, '.gitkeep');
    !fs.existsSync(dir) && fs.mkdirSync(dir);
    fs.writeFileSync(gitkeep, '');
  });

  const appIcon = path.resolve(assetsDir, 'image', 'app-icon.png');

  fs.copyFileSync(require.resolve('../assets/app-icon.png'), appIcon);

  const assetDeclarations = path.resolve(assetsDir, 'index.d.ts');
  fs.writeFileSync(
    assetDeclarations,
    `
import { ImageSourcePropType } from 'react-native';

declare module '*.png' {
  export default ImageSourcePropType;
}

declare module '*.jpg' {
  export default ImageSourcePropType;
}

declare module '*.jpeg' {
  export default ImageSourcePropType;
}

declare module '*.gif' {
  export default ImageSourcePropType;
}

declare module '*.mp4' {
  export default unknown;
}
    `.trim(),
  );

};

const createFileThunk = (root: string) => (f: readonly string[]): string => {
  return path.resolve(root, ...f);
};

const hardhatOptions = async (
  projectFile: (f: readonly string[]) => string,
  scriptFile: (f: readonly string[]) => string
): Promise<HardhatOptions> => {
  const hardhatAccounts = await Promise.all(
    [...Array(10)].map(async () => {
      const { privateKey } = await ethers.Wallet.createRandom();
      return { privateKey, balance: '1000000000000000000000' }; // 1000 ETH
    })
  );
  return {
    hardhat: scriptFile(['hardhat.ts']),
    hardhatConfig: projectFile(['hardhat.config.js']),
    hardhatAccounts,
  } as HardhatOptions;
};

const createBaseContext = async (
  params: createParams
): Promise<createContext> => {
  const { name } = params;
  const projectDir = path.resolve(name);
  const scriptsDir = path.resolve(projectDir, 'scripts');
  const testsDir = path.resolve(projectDir, '__tests__');
  const projectFile = createFileThunk(projectDir);
  const scriptFile = createFileThunk(scriptsDir);
  const srcDir = path.resolve(projectDir, 'frontend');
  return Object.freeze({
    ...params,
    yarn: fs.existsSync(projectFile(['yarn.lock'])),
    hardhat: await hardhatOptions(projectFile, scriptFile),
    projectDir,
    scriptsDir,
    testsDir,
    srcDir,
  });
};

// TODO: Find a nice version.
const shimProcessVersion = 'v9.40';

const injectShims = (ctx: createContext) => {
  const { projectDir } = ctx;
  fs.writeFileSync(
    path.resolve(projectDir, 'index.js'),
    `
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */

// This file has been auto-generated by Ξ create-react-native-dapp Ξ.
// Feel free to modify it, but please take care to maintain the exact
// procedure listed between /* dapp-begin */ and /* dapp-end */, as 
// this will help persist a known template for future migrations.

/* dapp-begin */
const { Platform, LogBox } = require('react-native');

if (Platform.OS !== 'web') {
  require('react-native-get-random-values');
  LogBox.ignoreLogs(
    [
      "Warning: The provided value 'ms-stream' is not a valid 'responseType'.",
      "Warning: The provided value 'moz-chunked-arraybuffer' is not a valid 'responseType'.",
    ],
  );
}

if (typeof Buffer === 'undefined') {
  global.Buffer = require('buffer').Buffer;
}

global.btoa = global.btoa || require('base-64').encode;
global.atob = global.atob || require('base-64').decode;

process.version = '${shimProcessVersion}';

const { registerRootComponent } = require('expo');
const { default: App } = require('./frontend/App');

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in the Expo client or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
/* dapp-end */
    `.trim()
  );
};

const createScripts = (ctx: createContext) => {
  const { scriptsDir } = ctx;
  !fs.existsSync(scriptsDir) && fs.mkdirSync(scriptsDir);
  const postinstall = path.resolve(scriptsDir, 'postinstall.ts');
  const android = path.resolve(scriptsDir, 'android.ts');
  const ios = path.resolve(scriptsDir, 'ios.ts');
  const web = path.resolve(scriptsDir, 'web.ts');
  fs.writeFileSync(
    postinstall,
    `
import 'dotenv/config';
import * as child_process from 'child_process';

child_process.execSync('npx pod-install', { stdio: 'inherit' });
    `.trim()
  );

  fs.writeFileSync(
    android,
    `
import 'dotenv/config';
import * as child_process from 'child_process';

import * as appRootPath from 'app-root-path';
import * as chokidar from 'chokidar';

const opts: child_process.ExecSyncOptions = { cwd: \`\${appRootPath}\`, stdio: 'inherit' };

chokidar.watch('contracts').on('all', () => {
  child_process.execSync('npx hardhat compile', opts);
});

child_process.execSync('npx kill-port ${port}', opts);
child_process.execSync('adb reverse tcp:${port} tcp:${port}', opts);
child_process.execSync('npx hardhat node --hostname 0.0.0.0 & react-native run-android &', opts);
    `.trim(),
  );
  fs.writeFileSync(
    ios,
    `
import 'dotenv/config';
import * as child_process from 'child_process';

import * as appRootPath from 'app-root-path';
import * as chokidar from 'chokidar';

const opts: child_process.ExecSyncOptions = { cwd: \`\${appRootPath}\`, stdio: 'inherit' };

chokidar.watch('contracts').on('all', () => {
  child_process.execSync('npx hardhat compile', opts);
});

child_process.execSync('npx kill-port ${port}', opts);
child_process.execSync('npx hardhat node --hostname 0.0.0.0 & react-native run-ios &', opts);
    `.trim(),
  );
  fs.writeFileSync(
    web,
    `
import 'dotenv/config';
import * as child_process from 'child_process';

import * as appRootPath from 'app-root-path';
import * as chokidar from 'chokidar';

const opts: child_process.ExecSyncOptions = { cwd: \`\${appRootPath}\`, stdio: 'inherit' };

chokidar.watch('contracts').on('all', () => {
  child_process.execSync('npx hardhat compile', opts);
});

child_process.execSync('npx kill-port 8545', opts);
child_process.execSync('expo web & npx hardhat node --hostname 0.0.0.0 &', opts);
    `.trim(),
  );
};

const getAllEnvVariables = (ctx: createContext): EnvVariables => {
  const { hardhat: { hardhatAccounts } } = ctx;
  return [
    ['HARDHAT_PORT', 'string', `${port}`],
    ['HARDHAT_PRIVATE_KEY', 'string', hardhatAccounts[0].privateKey],
  ];
};

const shouldPrepareTypeRoots = (ctx: createContext) => {
  const stringsToRender = getAllEnvVariables(ctx).map(
    ([name, type]: EnvVariable) => `   export const ${name}: ${type};`
  );
  return fs.writeFileSync(
    path.resolve(ctx.projectDir, 'index.d.ts'),
    `
declare module '@env' {
${stringsToRender.join('\n')}
}
    `.trim()
  );
};

const shouldPrepareSpelling = (ctx: createContext) => fs.writeFileSync(
  path.resolve(ctx.projectDir, '.cspell.json'),
  prettyStringify({
    words: ["bytecode", "dapp"],
  }),
);

const shouldPrepareTsc = (ctx: createContext) => {
  fs.writeFileSync(
    path.resolve(ctx.projectDir, 'tsconfig.json'),
    prettyStringify({
      compilerOptions: {
        allowSyntheticDefaultImports: true,
        jsx: 'react-native',
        lib: ['dom', 'esnext'],
        moduleResolution: 'node',
        noEmit: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        typeRoots: ['index.d.ts'],
        types: ['node', 'jest'],
      },
      include: ['**/*.ts', '**/*.tsx'],
      exclude: [
        'node_modules',
        'babel.config.js',
        'metro.config.js',
        'jest.config.js',
        '**/*.test.tsx',
        '**/*.test.ts',
        '**/*.spec.tsx',
        '**/*.spec.ts',
      ],
    })
  );
};

const preparePackage = (ctx: createContext) =>
  injectFlattenedJsonToFile(
    path.resolve(ctx.projectDir, 'package.json'),
    {
      license: 'MIT',
      contributors: [
        {
          name: '@cawfree',
          url: "https://github.com/cawfree"
        },
      ],
      keywords: [
        'react',
        'react-native',
        'blockchain',
        'dapp',
        'ethereum',
        'web3',
        'starter',
        'react-native-web',
      ],
      // scripts
      'scripts.postinstall': 'node_modules/.bin/ts-node scripts/postinstall',
      'scripts.test': 'npx hardhat test && jest',
      'scripts.android': 'node_modules/.bin/ts-node scripts/android',
      'scripts.ios': 'node_modules/.bin/ts-node scripts/ios',
      'scripts.web': 'node_modules/.bin/ts-node scripts/web',
      // dependencies
      'dependencies.@react-native-async-storage/async-storage': '1.13.4',
      'dependencies.@walletconnect/react-native-dapp': '1.4.1',
      'dependencies.react-native-svg': '12.1.0',
      'dependencies.base-64': '1.0.0',
      'dependencies.buffer': '6.0.3',
      'dependencies.node-libs-browser': '2.2.1',
      'dependencies.path-browserify': '0.0.0',
      'dependencies.react-native-crypto': '2.2.0',
      'dependencies.react-native-dotenv': '2.4.3',
      'dependencies.react-native-localhost': '1.0.0',
      'dependencies.react-native-get-random-values': '1.5.0',
      'dependencies.react-native-stream': '0.1.9',
      'dependencies.web3': '1.3.1',
      // devDependencies
      'devDependencies.app-root-path': '3.0.0',
      'devDependencies.chokidar': '3.5.1',
      'devDependencies.commitizen': '4.2.3',
      'devDependencies.cz-conventional-changelog': '^3.2.0',
      'devDependencies.dotenv': '8.2.0',
      'devDependencies.enzyme': '3.11.0',
      'devDependencies.enzyme-adapter-react-16': '1.15.6',
      'devDependencies.husky': '4.3.8',
      'devDependencies.prettier': '2.2.1',
      'devDependencies.@typescript-eslint/eslint-plugin': '^4.0.1',
      'devDependencies.@typescript-eslint/parser': '^4.0.1',
      'devDependencies.eslint': '^7.8.0',
      'devDependencies.eslint-config-prettier': '^6.11.0',
      'devDependencies.eslint-plugin-eslint-comments': '^3.2.0',
      'devDependencies.eslint-plugin-functional': '^3.0.2',
      'devDependencies.eslint-plugin-import': '^2.22.0',
      'devDependencies.eslint-plugin-react': '7.22.0',
      'devDependencies.eslint-plugin-react-native': '3.10.0',
      'devDependencies.lint-staged': '10.5.3',
      'devDependencies.@types/node': '14.14.22',
      "devDependencies.@types/jest": '^26.0.20',
      'devDependencies.hardhat': '2.0.6',
      'devDependencies.@nomiclabs/hardhat-ethers': '^2.0.1',
      'devDependencies.@nomiclabs/hardhat-waffle': '^2.0.1',
      'devDependencies.chai': '^4.2.0',
      'devDependencies.ethereum-waffle': '^3.2.1',
      'devDependencies.jest': '26.6.3',
      'devDependencies.react-test-renderer': '17.0.1',
      'devDependencies.ts-node': '9.1.1',
      // react-native
      'react-native.stream': 'react-native-stream',
      'react-native.crypto': 'react-native-crypto',
      'react-native.path': 'path-browserify',
      'react-native.process': 'node-libs-browser/mock/process',
      // jest
      'jest.preset': 'react-native',
      'jest.testMatch': ["**/__tests__/frontend/**/*.[jt]s?(x)"],
    },
    {
      config: {
        commitizen: {
          path: './node_modules/cz-conventional-changelog'
        }
      },
      husky: {
        hooks: {
          'prepare-commit-msg': 'exec < /dev/tty && git cz --hook',
          'pre-commit': 'lint-staged',
          'pre-push': 'test'
        }
      },
      'lint-staged': {
        '*.{ts,tsx,js,jsx}': "eslint --ext '.ts,.tsx,.js,.jsx' -c .eslintrc.json",
      },
    }
  );

const shouldPrepareMetro = (ctx: createContext) =>
  fs.writeFileSync(
    path.resolve(ctx.projectDir, 'metro.config.js'),
    `
const extraNodeModules = require('node-libs-browser');

module.exports = {
  resolver: {
    extraNodeModules,
  },
  transformer: {
    assetPlugins: ['expo-asset/tools/hashAssetFiles'],
  },
};
    `.trim()
  );

const shouldPrepareBabel = (ctx: createContext) =>
  fs.writeFileSync(
    path.resolve(ctx.projectDir, 'babel.config.js'),
    `
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module:react-native-dotenv'],
    ],
  };
};
    `.trim()
  );

const shouldPrepareEslint = (ctx: createContext) =>
  fs.writeFileSync(
    path.resolve(ctx.projectDir, '.eslintrc.json'),
    prettyStringify({
      root: true,
      parser: '@typescript-eslint/parser',
      env: { es6: true },
      ignorePatterns: [
        'node_modules',
        'build',
        'coverage',
        'babel.config.js',
        'metro.config.js',
        'hardhat.config.js',
        '__tests__/contracts',
      ],
      plugins: ['import', 'eslint-comments', 'functional', 'react', 'react-native'],
      extends: [
        'eslint:recommended',
        'plugin:eslint-comments/recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:import/typescript',
        'plugin:functional/lite',
        'prettier',
        'prettier/@typescript-eslint',
      ],
      globals: {
        // TODO: Enable support in RN for BigInteger.
        //BigInt: true,
        console: true,
        __DEV__: true,
      },
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        'eslint-comments/disable-enable-pair': [
          'error',
          { allowWholeFile: true },
        ],
        'eslint-comments/no-unused-disable': 'error',
        'import/order': [
          'error',
          { 'newlines-between': 'always', alphabetize: { order: 'asc' } },
        ],
        'sort-imports': [
          'error',
          { ignoreDeclarationSort: true, ignoreCase: true },
        ],
        'sort-keys': [
          'error',
          'asc',
          {
            'caseSensitive': true,
            'natural': false,
            'minKeys': 2,
          },
        ],
        'react-native/no-unused-styles': 2,
        'react-native/split-platform-components': 2,
        'react-native/no-inline-styles': 2,
        'react-native/no-color-literals': 2,
        'react-native/no-raw-text': 2,
        'react-native/no-single-element-style-arrays': 2,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    })
  );

const shouldWriteEnv = (ctx: createContext) => {
  const lines = getAllEnvVariables(ctx).map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ([name, _type, value]) => `${name}=${value}`
  );
  const env = path.resolve(ctx.projectDir, '.env');
  const example = path.resolve(ctx.projectDir, '.env.example');
  fs.writeFileSync(env, `${lines.join('\n')}\n`);
  fs.copyFileSync(env, example);
};

const shouldInstall = (ctx: createContext) =>
  execSync(
    `cd ${ctx.projectDir}; ${
      ctx.yarn ? 'yarn' : 'npm i'
    }; `.trim(),
    {
      stdio: 'inherit',
    }
  );

const getExampleContract = () =>
  `
// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

import "hardhat/console.sol";

contract Hello {
  string defaultSuffix;
  constructor() {
    defaultSuffix = '!';
  }
  function sayHello(string memory name) public view returns(string memory) {
    console.log("Saying hello to %s!", msg.sender);
    return string(abi.encodePacked("Welcome to ", name, defaultSuffix));
  }
}
`.trim();

const shouldPrepareExample = (ctx: createContext) => {
  const {
    projectDir,
    testsDir,
    srcDir,
    hardhat: {
     hardhatConfig,
     hardhatAccounts,
    },
  } = ctx;

  const contracts = path.resolve(projectDir, 'contracts');

  !fs.existsSync(contracts) && fs.mkdirSync(contracts);
  !fs.existsSync(testsDir) && fs.mkdirSync(testsDir);

  const contractsTestDir = path.resolve(testsDir, 'contracts');
  const frontendTestDir = path.resolve(testsDir, 'frontend');

  fs.mkdirSync(contractsTestDir);
  fs.mkdirSync(frontendTestDir);

  fs.writeFileSync(path.resolve(contractsTestDir, '.gitkeep'), '');
  fs.writeFileSync(path.resolve(frontendTestDir, '.gitkeep'), '');

  const contractTest = path.resolve(contractsTestDir, 'Hello.test.js');
  const frontendTest = path.resolve(frontendTestDir, 'App.test.tsx');

  fs.writeFileSync(
    contractTest,
    `
const { expect } = require('chai');

describe("Hello", function() {
  it("Should return the default greeting", async function() {
    const Hello = await ethers.getContractFactory("Hello");
    const hello = await Hello.deploy();
    
    await hello.deployed();

    expect(await hello.sayHello("React Native")).to.equal("Welcome to React Native!");
    expect(await hello.sayHello("Web3")).to.equal("Welcome to Web3!");
  });
});
    `
  );

  fs.writeFileSync(
    frontendTest,
    `
import Enzyme from 'enzyme';
import Adapter from 'enzyme-adapter-react-16';
import React from 'react';
 
import App from '../../frontend/App';

Enzyme.configure({ adapter: new Adapter() });

test('renders correctly', () => {
  const wrapper = Enzyme.shallow(<App />);

  expect(wrapper.find({ testID: 'tid-message'}).contains('Loading...')).toBe(true);
});
    `.trim(),
  );

  const contract = path.resolve(contracts, 'Hello.sol');
  fs.writeFileSync(contract, getExampleContract());

  fs.writeFileSync(
    hardhatConfig,
    `
/**
 * @type import('hardhat/config').HardhatUserConfig
 */
require("@nomiclabs/hardhat-waffle");
require("dotenv/config");

const { HARDHAT_PORT } = process.env;

module.exports = {
  solidity: "0.7.3",
  networks: {
    localhost: { url: \`http://127.0.0.1:\${HARDHAT_PORT}\` },
    hardhat: {
      accounts: ${JSON.stringify(hardhatAccounts)}
    },
  },
  paths: {
    sources: './contracts',
    tests: './__tests__/contracts',
    cache: './cache',
    artifacts: './artifacts',
  },
};
    `.trim()
  );

  !fs.existsSync(srcDir) && fs.mkdirSync(srcDir);

  fs.writeFileSync(
    path.resolve(srcDir, 'App.tsx'),
    `
import { HARDHAT_PORT, HARDHAT_PRIVATE_KEY } from '@env';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWalletConnect, withWalletConnect } from '@walletconnect/react-native-dapp';
import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import localhost from 'react-native-localhost';
import Web3 from 'web3';

import { expo } from '../app.json';
import Hello from '../artifacts/contracts/Hello.sol/Hello.json';

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  // eslint-disable-next-line react-native/no-color-literals
  white: { backgroundColor: 'white' },
});

const shouldDeployContract = async (web3, abi, data, from: string) => {
  const deployment = new web3.eth.Contract(abi).deploy({ data });
  const gas = await deployment.estimateGas();
  const {
    options: { address: contractAddress },
  } = await deployment.send({ from, gas });
  return new web3.eth.Contract(abi, contractAddress);
};

function App(): JSX.Element {
  const connector = useWalletConnect();
  const [message, setMessage] = React.useState<string>('Loading...');
  const web3 = React.useMemo(
    () => new Web3(new Web3.providers.HttpProvider(\`http://\${localhost}:\${HARDHAT_PORT}\`)),
    [HARDHAT_PORT]
  );
  React.useEffect(() => {
    (async () => {
      const { address } = await web3.eth.accounts.privateKeyToAccount(HARDHAT_PRIVATE_KEY);
      const contract = await shouldDeployContract(
        web3,
        Hello.abi,
        Hello.bytecode,
        address
      );
      setMessage(await contract.methods.sayHello('React Native').call());
    })();
  }, [web3, shouldDeployContract, setMessage, HARDHAT_PRIVATE_KEY]);
  const connectWallet = React.useCallback(() => {
    return connector.connect();
  }, [connector]);
  const signTransaction = React.useCallback(async () => {
    try {
       await connector.signTransaction({
        data: '0x',
        from: '0xbc28Ea04101F03aA7a94C1379bc3AB32E65e62d3',
        gas: '0x9c40',
        gasPrice: '0x02540be400',
        nonce: '0x0114',
        to: '0x89D24A7b4cCB1b6fAA2625Fe562bDd9A23260359',
        value: '0x00',
      });
    } catch (e) {
      console.error(e);
    }
  }, [connector]);
  const killSession = React.useCallback(() => {
    return connector.killSession();
  }, [connector]);
  return (
    <View style={[StyleSheet.absoluteFill, styles.center, styles.white]}>
      <Text testID="tid-message">{message}</Text>
      {!connector.connected && (
        <TouchableOpacity onPress={connectWallet}>
          <Text>Connect a Wallet</Text>
        </TouchableOpacity>
      )}
      {!!connector.connected && (
        <>
          <TouchableOpacity onPress={signTransaction}>
            <Text>Sign a Transaction</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={killSession}>
            <Text>Kill Session</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const { scheme } = expo;

export default withWalletConnect(App, {
  redirectUrl: Platform.OS === 'web' ? window.location.origin : \`\${scheme}://\`,
  storageOptions: {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    asyncStorage: AsyncStorage,
  },
});
    `.trim()
  );

  const orig = path.resolve(projectDir, 'App.tsx');
  fs.existsSync(orig) && fs.unlinkSync(orig);

  execSync(`cd ${projectDir} && npx hardhat compile`, { stdio: 'inherit' });
};

const getHardhatGitIgnore = (): string | null => {
  return `
# Hardhat
artifacts/
cache/
  `.trim();
};

const shouldPrepareGitignore = (ctx: createContext) => {
  const { projectDir } = ctx;
  const lines = [getHardhatGitIgnore()].filter((e) => !!e) as readonly string[];
  const gitignore = path.resolve(projectDir, '.gitignore');
  fs.writeFileSync(
    gitignore,
    `
${fs.readFileSync(gitignore, 'utf-8')}
# Environment Variables (Store safe defaults in .env.example!)
.env

# Jest
.snap

# Package Managers
${ctx.yarn ? 'package-lock.json' : 'yarn.lock'}

${lines.join('\n\n')}

  `.trim()
  );
};

const getScriptCommandString = (ctx: createContext, str: string) =>
  chalk.white.bold`${ctx.yarn ? 'yarn' : 'npm run-script'} ${str}`;

export const getSuccessMessage = (ctx: createContext): string => {
  return `
${chalk.green`✔`} Successfully integrated Web3 into React Native!

To compile and run your project in development, execute one of the following commands:
- ${getScriptCommandString(ctx, `ios`)}
- ${getScriptCommandString(ctx, `android`)}
- ${getScriptCommandString(ctx, `web`)}

  `.trim();
};

export const create = async (params: createParams): Promise<createResult> => {
  createBaseProject(params);

  const ctx = await createBaseContext(params);

  if (!fs.existsSync(ctx.projectDir)) {
    return Object.freeze({
      ...ctx,
      status: CreationStatus.FAILURE,
      message: `Failed to resolve project directory.`,
    });
  }

  setAppIcon(ctx);
  ejectExpoProject(ctx);
  injectShims(ctx);
  createScripts(ctx);
  preparePackage(ctx);
  shouldPrepareMetro(ctx);
  shouldPrepareBabel(ctx);
  shouldPrepareEslint(ctx);
  shouldPrepareTypeRoots(ctx);
  shouldPrepareSpelling(ctx);
  shouldPrepareTsc(ctx);
  shouldPrepareGitignore(ctx);
  shouldWriteEnv(ctx);
  shouldInstall(ctx);
  shouldPrepareExample(ctx);

  return Object.freeze({
    ...ctx,
    status: CreationStatus.SUCCESS,
    message: getSuccessMessage(ctx),
  });
};
