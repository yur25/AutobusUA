export interface PageQuery {
    page?: number;
    pageSize?: number;
}

export function paginate<T>(
    values: T[],
    query: PageQuery,
): {
    items: T[];
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
} {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const start = (page - 1) * pageSize;

    return {
        items: values.slice(start, start + pageSize),
        page,
        pageSize,
        totalItems: values.length,
        totalPages: Math.ceil(values.length / pageSize),
    };
}
