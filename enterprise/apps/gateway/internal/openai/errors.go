package openai

import "net/http"

type APIError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	HTTPStatus int    `json:"-"`
}

func BadRequest(message string) APIError {
	return APIError{
		Code:       "40000",
		Message:    message,
		HTTPStatus: http.StatusBadRequest,
	}
}

func Unauthorized(message string) APIError {
	return APIError{
		Code:       "40100",
		Message:    message,
		HTTPStatus: http.StatusUnauthorized,
	}
}

func PolicyBlocked(message string) APIError {
	return APIError{
		Code:       "90001",
		Message:    message,
		HTTPStatus: http.StatusForbidden,
	}
}

func Internal(message string) APIError {
	return APIError{
		Code:       "50000",
		Message:    message,
		HTTPStatus: http.StatusInternalServerError,
	}
}
