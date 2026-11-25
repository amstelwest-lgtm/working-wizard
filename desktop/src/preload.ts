import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("milon", {
  getState: () => ipcRenderer.invoke("get-state"),
  signIn: (email: string, password: string) => ipcRenderer.invoke("sign-in", { email, password }),
  signOut: () => ipcRenderer.invoke("sign-out"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  setClient: (clientId: string) => ipcRenderer.invoke("set-client", clientId),
  setPeriod: (period: string) => ipcRenderer.invoke("set-period", period),
  refreshClients: () => ipcRenderer.invoke("refresh-clients"),
  answer: (id: string, text: string) => ipcRenderer.invoke("answer", { id, text }),
  onState: (callback: (state: unknown) => void) => {
    ipcRenderer.on("state", (_event, state: unknown) => callback(state));
  },
});
