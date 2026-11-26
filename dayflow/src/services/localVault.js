import Store from './store';

// Everything DayFlow writes to this device, in one place — so deleting an
// account can be exhaustive rather than a list of keys that drifts out of date
// as features are added.
const LOCAL_KEYS = [
  '@dayflow_vault_v2',      // encrypted tasks and tombstones
  '@dayflow_vault_record',  // the wrapped data key
  '@dayflow_agent_inbox',   // encrypted agent suggestions, Mac app only
  '@dayflow_agent_inbox_unreadable',
  '@dayflow_agent_export',  // whether the Drive export is switched on
];

export async function clearVaultData() {
  await Store.multiRemove(LOCAL_KEYS);
}
