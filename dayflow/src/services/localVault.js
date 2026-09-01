import AsyncStorage from '@react-native-async-storage/async-storage';

// Everything DayFlow writes to this device, in one place — so deleting an
// account can be exhaustive rather than a list of keys that drifts out of date
// as features are added.
export const LOCAL_KEYS = [
  '@dayflow_vault_v2',      // encrypted tasks and tombstones
  '@dayflow_vault_record',  // the wrapped data key
];

export async function clearVaultData() {
  await AsyncStorage.multiRemove(LOCAL_KEYS);
}
