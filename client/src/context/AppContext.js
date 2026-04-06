import React, { createContext, useState, useEffect, useCallback, useContext } from 'react';
import { settingsApi } from '../utils/api';
import { AuthContext } from './AuthContext';

const DEFAULT_ROLES = [
  { value: 'cto',               label: 'CTO' },
  { value: 'lead_blockchain',   label: 'Lead Blockchain Engineer' },
  { value: 'smart_contract',    label: 'Smart Contract Engineer' },
  { value: 'backend',           label: 'Backend Engineer' },
  { value: 'frontend_web3',     label: 'Frontend Engineer (Web3)' },
  { value: 'designer',          label: 'Designer' },
  { value: 'strategic_partner', label: 'Strategic Partner' },
  { value: 'advisor',           label: 'Advisor' },
];

export const AppContext = createContext({
  roles: DEFAULT_ROLES, DEFAULT_ROLES,
  recruiters: [],
  companyScenario: '',
  dbConnected: false,
  refreshSettings: () => {},
});

export function AppProvider({ children }) {
  const authCtx = useContext(AuthContext);
  const [roles,           setRoles]           = useState(DEFAULT_ROLES);
  const [recruiters,      setRecruiters]       = useState([]);
  const [companyScenario, setCompanyScenario]  = useState('');
  const [dbConnected,     setDbConnected]      = useState(false);

  const refreshSettings = useCallback(async () => {
    try {
      const data = await settingsApi.getAll();
      setDbConnected(data.dbConnected || false);
      setRoles(data.roles?.length ? data.roles : DEFAULT_ROLES);
      setRecruiters(Array.isArray(data.recruiters) ? data.recruiters : []);
      setCompanyScenario(data.companyScenario || '');
    } catch (_) {}
  }, []);

  // Refresh settings whenever the logged-in user changes
  useEffect(() => {
    if (authCtx?.user) refreshSettings();
  }, [authCtx?.user, refreshSettings]);

  return (
    <AppContext.Provider value={{ roles, DEFAULT_ROLES, recruiters, companyScenario, dbConnected, refreshSettings }}>
      {children}
    </AppContext.Provider>
  );
}
