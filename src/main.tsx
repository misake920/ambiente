import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import './reference.css';
import App from './App';
import Overlay from './Overlay';
const token=new URLSearchParams(location.search).get('overlay');
ReactDOM.createRoot(document.getElementById('root')!).render(token?<Overlay token={token}/>:<App/>);
