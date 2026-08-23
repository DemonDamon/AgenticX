package database

import (
	"errors"

	mysqlDriver "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
)

// IsMissingRelation reports whether err is the database saying a table or column
// named in the statement does not exist.
//
// 这个区分是给「查询失败时该放行还是该拒绝」用的，两类错误的含义完全不同：
//
//   - 表/列不存在：结构性的，说明这套表压根没迁移过。此时不可能有任何分配数据，
//     按「不归能力包管」处理不会放过任何本该被撤销的人。
//   - 其它一切（连不上、超时、死锁、权限不足）：暂时性的，表可能好好地在那儿装着
//     撤销记录。这时候放行就等于「把库弄挂就能绕过撤销」。
//
// 因此只认错误码，不做字符串匹配——"no such table" 这类文案会随驱动和语言变。
func IsMissingRelation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		// 42P01 undefined_table, 42703 undefined_column
		return pgErr.Code == "42P01" || pgErr.Code == "42703"
	}
	var myErr *mysqlDriver.MySQLError
	if errors.As(err, &myErr) {
		// 1146 ER_NO_SUCH_TABLE, 1054 ER_BAD_FIELD_ERROR
		return myErr.Number == 1146 || myErr.Number == 1054
	}
	return false
}
