import Address from './Address';
import CreatedUpdatedProps from './CreatedUpdatedProps';
// import  Wallet from './Wallet';

export default interface Tenant extends CreatedUpdatedProps {
  id: string;
  name: string;
  email: string;
  subdomain: string;
  // wallet :Wallet;
  address: Address;
  logo: string;
  components: TenantComponent;
  cpmsDomainName?: string; // Optional - domain name used to connect chargers
  redirectDomain?: string;
  idleMode?: boolean // Prevents batch and async tasks executions when moving the tenant to a different cloud infrastructure provider
  taskExecutionEnv?: string; // Environment on which tasks should be executed
}

export interface TenantComponent {
  wallet?: TenantComponentContent;
  ocpi?: TenantComponentContent;
  oicp?: TenantComponentContent;
  organization?: TenantComponentContent;
  pricing?: TenantComponentContent;
  billing?: TenantComponentContent;
  billingPlatform?: TenantComponentContent;
  refund?: TenantComponentContent;
  statistics?: TenantComponentContent;
  analytics?: TenantComponentContent;
  smartCharging?: TenantComponentContent;
  asset?: TenantComponentContent;
  car?: TenantComponentContent;
  carConnector?: TenantComponentContent;
}

export interface TenantComponentContent {
  active: boolean;
  type: string;
}

export interface TenantLogo {
  id: string;
  logo: string;
}

export enum TenantComponents {
  WALLET ='wallet',
  OCPI = 'ocpi',
  OICP = 'oicp',
  REFUND = 'refund',
  PRICING = 'pricing',
  ORGANIZATION = 'organization',
  STATISTICS = 'statistics',
  ANALYTICS = 'analytics',
  BILLING = 'billing',
  BILLING_PLATFORM = 'billingPlatform',
  ASSET = 'asset',
  SMART_CHARGING = 'smartCharging',
  CAR = 'car',
  CAR_CONNECTOR = 'carConnector'
}
