import type {
  CustomerDirectory,
  CustomerLookup,
  CustomerLookupResult,
} from './customer-directory.js';

// Used until a customer data source is configured. Fails closed: it never
// says anyone is registered.
export class NoopCustomerDirectory implements CustomerDirectory {
  async lookup(_query: CustomerLookup): Promise<CustomerLookupResult> {
    return { status: 'unavailable' };
  }
}
