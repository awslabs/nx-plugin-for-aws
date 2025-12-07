import React from 'react';

interface AlertProps {
  type: string;
  header: string;
  children: React.ReactNode;
}

export const Alert: React.FC<AlertProps> = ({ type, header, children }) => (
  <div className={`alert alert-${type}`} role="alert">
    <div className="alert-header">{header}</div>
    <div className="alert-body">{children}</div>
  </div>
);
