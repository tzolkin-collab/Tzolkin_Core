export class Store {
  constructor(initialState = {}) {
    this.state = { ...initialState };
    this.listeners = new Map();
  }

  get(key) {
    if (!key) return this.state;
    return this.state[key];
  }

  set(key, value) {
    this.state[key] = value;
    this.notify(key, value);
  }

  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);
    
    // Return unsubscribe function
    return () => {
      this.listeners.get(key).delete(callback);
    };
  }

  notify(key, value) {
    if (this.listeners.has(key)) {
      for (const callback of this.listeners.get(key)) {
        try {
          callback(value);
        } catch (err) {
          console.error(`Error in subscriber for ${key}:`, err);
        }
      }
    }
    
    // Also notify generic listeners if we want to add them in the future
    if (this.listeners.has('*')) {
      for (const callback of this.listeners.get('*')) {
        try {
          callback(key, value);
        } catch (err) {
          console.error(`Error in generic subscriber for ${key}:`, err);
        }
      }
    }
  }
}

export const store = new Store({
  context: '', 
  view: 'overview', 
  overview: null, 
  product: null, 
  catalog: [], 
  deploys: [], 
  resourceBindings: [], 
  infrastructure: null, 
  management: null, 
  dns: null, 
  topology: null, 
  security: null, 
  selectedTenant: null, 
  clientSummary: null, 
  clientBack: 'clients', 
  inboundTab: 'leads', 
  configSecao: '', 
  configRetorno: '', 
  portfolioTab: 'all', 
  clientTab: 'all', 
  clientPage: 0, 
  empresaAba: 'geral'
});

export const stateProxy = new Proxy(store.state, {
  set(target, prop, value) {
    store.set(prop, value);
    return true;
  },
  get(target, prop) {
    return store.get(prop);
  }
});
