import React from 'react';
import useAppLogic from './AppLogic';
import AppUI from './AppUI';

export default function App(){
  const logic = useAppLogic();
  return <AppUI logic={logic} />;
}
