// The randomness polyfill comes first, and must stay first.
//
// crypto-js captures `globalThis.crypto` when its module body runs and keeps
// whatever it found. On Hermes there is nothing there to find, so unless this
// import has already run, AES has no source of salt — and the failure surfaces
// as silently unencrypted data rather than as an error. Importing it here, above
// everything, is what guarantees it wins that race.
import './src/services/secureRandom';

import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
