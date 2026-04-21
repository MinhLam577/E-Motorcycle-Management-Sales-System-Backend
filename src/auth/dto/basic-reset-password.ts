import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export default class BasicResetPassword {
  @ApiProperty({
    example: '',
    name: 'id',
    description: 'id user',
  })
  @IsNotEmpty({
    message: 'id không được để trống',
  })
  id: string;
  @ApiProperty({
    example: '',
    name: 'newPassword',
    description: 'Mật khẩu mới',
  })
  @IsNotEmpty({
    message: 'Mật khẩu mới không được để trống',
  })
  newPassword: string;
  @ApiProperty({
    example: '',
    name: 'oldPassword',
    description: 'Mật khẩu cũ',
  })
  @IsNotEmpty({
    message: 'Mật khẩu cũ không được để trống',
  })
  oldPassword: string;
}
