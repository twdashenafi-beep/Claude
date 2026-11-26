'use strict';

// The only things the page is given beyond an ordinary browser tab: the four
// agent-inbox calls. Each is a message to the main process, which decides
// whether to honour it; nothing here touches a file.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dayflowDesktop', {
  agentInbox: {
    status: () => ipcRenderer.invoke('agent-inbox:status'),
    list: () => ipcRenderer.invoke('agent-inbox:list'),
    settle: (name, outcome, reason) => ipcRenderer.invoke('agent-inbox:settle', name, outcome, reason),
    writeExport: text => ipcRenderer.invoke('agent-inbox:write-export', text),
  },
});
