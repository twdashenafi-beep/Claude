import Store from './store';

// Everything DayFlow writes to this device, in one place — so deleting an
// account can be exhaustive rather than a list of keys that drifts out of date
// as features are added.
const LOCAL_KEYS = [
  '@dayflow_vault_v2',      // encrypted tasks and tombstones
  '@dayflow_vault_record',  // the wrapped data key
];

export async function clearVaultData() {
  await Store.multiRemove(LOCAL_KEYS);
}
