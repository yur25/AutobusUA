export interface PageQuery {
    page?: number;
    pageSize?: number;
}

export interface Page<T> {
    items: T[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
}

export function createPage<T>(items: T[], totalItems: number, query: PageQuery): Page<T> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    return {
        items,
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
    };
}
