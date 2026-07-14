import type { Module } from '../store/types.js';

/**
 * Per-module OAuth scopes — the two modules are independently connectable.
 * Both Google scopes are "sensitive": production use requires OAuth app
 * verification (testing mode with allowlisted users covers the build).
 */
export const MODULE_SCOPES: Record<Module, string[]> = {
  gbp: ['https://www.googleapis.com/auth/business.manage', 'openid', 'email'],
  ads: ['https://www.googleapis.com/auth/adwords', 'openid', 'email'],
};
