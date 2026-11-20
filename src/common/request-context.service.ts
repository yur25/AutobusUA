import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContextStore {
    businessProcessId: string;
    userId?: string;
}

@Injectable()
export class RequestContextService {
    private readonly storage = new AsyncLocalStorage<RequestContextStore>();

    run<T>(store: RequestContextStore, callback: () => T): T {
        return this.storage.run(store, callback);
    }

    get businessProcessId(): string | undefined {
        return this.storage.getStore()?.businessProcessId;
    }

    setUserId(userId: string): void {
        const store = this.storage.getStore();
        if (store) {
            store.userId = userId;
        }
    }
}
